import Report, { REPORT_CHAIN } from "../models/Report.js";
import Task from "../models/Task.js";
import Team, { ACTIVE_TEAM } from "../models/Team.js";
import User, { ADMIN_ROLES, HR_PANEL_ROLES } from "../models/User.js";

import { logActivity } from "../utils/activity.js";
import { notifyUser, notifyUsers } from "../utils/notify.js";
import { chainFor, reportTargetFor, reportsToMe } from "../utils/hierarchy.js";

/**
 * The reporting chain, from any panel.
 *
 *   Team Member  --member_update-->  Manager
 *   Manager      --team_update---->  HR
 *   HR           --hr_report------>  Admin
 *
 * One controller for all four levels, because it is one journey and the only
 * thing that differs at each step is who is above you — which utils/hierarchy
 * already answers. Four copies of this would be four places for the chain to
 * drift, and the drift would be silent: a report that goes to the wrong inbox
 * does not error, it just never gets read.
 *
 * Whoever is asking arrives on a different request property depending on the
 * panel, so every handler starts by working out who that is.
 */

const actorOf = (req) => req.admin || req.hr || req.leader || req.employee;

/** A trimmed list of strings from either a list or a newline-separated block. */
const lines = (value) => {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  return String(value || "")
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const shape = (report) => ({
  ...(report.toObject ? report.toObject() : report),
  // A Map does not survive JSON on its own
  metrics:
    report.metrics instanceof Map ? Object.fromEntries(report.metrics) : report.metrics || {},
});

/* ------------------------------------------------------------ what to write */

/**
 * GET /reports/context
 *
 * What this person is expected to submit, and to whom. The compose screen
 * asks this rather than deciding for itself — the direction of travel is the
 * server's to know.
 */
export const reportContext = async (req, res) => {
  try {
    const me = actorOf(req);
    const target = await reportTargetFor(me);

    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;

    /**
     * Whatever this level's numbers are, pre-counted.
     *
     * A report nobody has to assemble by hand is a report that gets filed. The
     * figures are suggestions on the form rather than stored values — the
     * author can change them, because they are the one who knows whether the
     * number tells the truth.
     */
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59, 999);

    const below = await reportsToMe(me);
    const scope = below === null ? {} : { assignedTo: { $in: [...below, me._id] } };

    const [taskRows, alreadyFiled] = await Promise.all([
      Task.aggregate([
        { $match: { ...scope, updatedAt: { $gte: from, $lte: to } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Report.findOne({ author: me._id, year, month, kind: target.kind }),
    ]);

    const tasks = {};
    taskRows.forEach((row) => {
      tasks[row._id] = row.count;
    });

    return res.status(200).json({
      kind: target.kind,
      chain: REPORT_CHAIN[target.kind],
      goesTo: target.to
        ? { _id: target.to._id, name: target.to.name, role: target.to.role }
        : target.group.length
          ? { name: target.groupName, count: target.group.length }
          : null,
      // The compose screen says plainly when there is nobody above to send to
      blocked: !target.to && !target.group.length,
      department: target.chain.department,
      team: target.chain.team,
      period: { year, month },
      suggestedMetrics: {
        tasksCompleted: tasks.completed || 0,
        tasksPending: (tasks.pending || 0) + (tasks.in_progress || 0),
        tasksInReview: tasks.review || 0,
      },
      // One report per person per month per kind — say so before they write it
      existing: alreadyFiled ? shape(alreadyFiled) : null,
    });
  } catch (err) {
    console.error("reportContext error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- outbox */

/** GET /reports/mine — what I have sent, and what came back. */
export const myReports = async (req, res) => {
  try {
    const me = actorOf(req);

    const query = { author: me._id };
    if (req.query.year) query.year = Number(req.query.year);
    if (req.query.status && req.query.status !== "all") query.status = req.query.status;

    const items = await Report.find(query)
      .populate("submittedTo", "name role")
      .populate("sources", "title authorName kind")
      .sort({ year: -1, month: -1, createdAt: -1 })
      .limit(100);

    return res.status(200).json({
      items: items.map(shape),
      total: items.length,
      awaitingAnswer: items.filter((r) => r.status === "submitted").length,
      answered: items.filter((r) => r.status === "responded").length,
    });
  } catch (err) {
    console.error("myReports error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- inbox */

/**
 * GET /reports/inbox
 *
 * What has been sent up to me. An admin sees every HR report; HR sees every
 * team update; a manager sees their own team's updates.
 */
export const reportInbox = async (req, res) => {
  try {
    const me = actorOf(req);
    const isAdmin = ADMIN_ROLES.includes(me.role);
    const isHr = HR_PANEL_ROLES.includes(me.role);

    /**
     * An administrator's inbox is every HR report, and an HR account's inbox
     * is every team update — not only the ones carrying their id.
     *
     * Both are functions several people staff. Addressing a report to one of
     * them by id would make it invisible to the others, which is exactly how a
     * company with two HR Managers loses half of what is sent up.
     */
    const query = isAdmin
      ? { kind: "hr_report", status: { $ne: "draft" } }
      : isHr
        ? { kind: "team_update", status: { $ne: "draft" } }
        : { submittedTo: me._id, status: { $ne: "draft" } };

    if (req.query.year) query.year = Number(req.query.year);
    if (req.query.month) query.month = Number(req.query.month);
    if (req.query.department && req.query.department !== "all") {
      query.department = req.query.department;
    }
    if (req.query.status && req.query.status !== "all") query.status = req.query.status;

    const items = await Report.find(query)
      .populate("author", "name email role designation")
      .populate("team", "name kind")
      .populate("sources", "title authorName kind status")
      .sort({ submittedAt: -1 })
      .limit(200);

    return res.status(200).json({
      items: items.map(shape),
      total: items.length,
      // The number that matters on an inbox: what nobody has answered yet
      waiting: items.filter((r) => r.status === "submitted").length,
      blockers: items.reduce((sum, r) => sum + (r.blockers?.length || 0), 0),
    });
  } catch (err) {
    console.error("reportInbox error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** GET /reports/:id — one report, with everything under it. */
export const reportDetail = async (req, res) => {
  try {
    const me = actorOf(req);

    const report = await Report.findById(req.params.id)
      .populate("author", "name email role designation")
      .populate("submittedTo", "name role")
      .populate("team", "name kind")
      .populate({
        path: "sources",
        populate: { path: "author", select: "name role designation" },
      })
      .populate("rolledInto", "title kind status");

    if (!report) return res.status(404).json({ message: "Report not found" });

    /**
     * You may read it if you wrote it, if it was sent to you, if you are an
     * administrator, or if it sits underneath something addressed to you —
     * that last one is what makes drilling down from a summary work at all.
     */
    const mine = String(report.author?._id || report.author) === String(me._id);
    const toMe = String(report.submittedTo?._id || report.submittedTo || "") === String(me._id);
    const isAdmin = ADMIN_ROLES.includes(me.role);

    // Addressed to a function this person staffs, rather than to their name
    const toMyFunction =
      (report.kind === "hr_report" && isAdmin) ||
      (report.kind === "team_update" && HR_PANEL_ROLES.includes(me.role));

    /**
     * Or it sits underneath something addressed to me. That is what makes
     * drilling from a summary down to the week behind a figure work at all —
     * HR reading a team update can open the member updates it summarises.
     */
    let viaParent = false;
    if (!mine && !toMe && !isAdmin && !toMyFunction && report.rolledInto) {
      const parent = await Report.findById(report.rolledInto).select("submittedTo kind");
      viaParent =
        String(parent?.submittedTo || "") === String(me._id) ||
        (parent?.kind === "team_update" && HR_PANEL_ROLES.includes(me.role));
    }

    if (!mine && !toMe && !isAdmin && !toMyFunction && !viaParent) {
      return res.status(403).json({ message: "That report was not sent to you" });
    }

    return res.status(200).json({ item: shape(report) });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Report not found" });
    console.error("reportDetail error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------- writing */

/**
 * POST /reports
 *
 * Write and send one. The kind and the recipient are decided by the server
 * from who is asking — a member cannot file a team update, and nobody can
 * address a report to somebody who is not above them.
 */
export const submitReport = async (req, res) => {
  try {
    const me = actorOf(req);
    const target = await reportTargetFor(me);

    if (!target.to && !target.group.length) {
      return res.status(409).json({
        message:
          target.kind === "member_update"
            ? "You are not on a team yet — ask your manager to add you"
            : "There is no HR account to send this to yet",
      });
    }

    const now = new Date();
    const year = Number(req.body.year) || now.getFullYear();
    const month = Number(req.body.month) || now.getMonth() + 1;

    /**
     * One per person per month per kind. A second report for the same month is
     * nearly always somebody re-writing the first, and two of them in an inbox
     * is worse than one — so the existing one is updated instead.
     */
    const existing = await Report.findOne({ author: me._id, kind: target.kind, year, month });

    if (existing && existing.status !== "draft" && existing.status !== "submitted") {
      return res.status(409).json({
        message: "That report has already been read — write next month's instead",
      });
    }

    const title = String(req.body.title || "").trim();
    if (!title) return res.status(400).json({ message: "Give the report a title" });

    /**
     * What this report rolls up. A manager naming the member updates they are
     * summarising, or HR naming the team updates — checked against what was
     * actually sent to them so nobody can attach a report they never received.
     */
    /**
     * Checked against what was actually sent to this person, so nobody can
     * attach a report they never received.
     *
     * "Sent to me" has two meanings and both count. A member update carries a
     * manager's id, but a team update is addressed to HR as a function and
     * carries no id at all — validating on `submittedTo` alone silently
     * dropped every source HR named, and the chain lost its drill-down with
     * no error to show for it.
     */
    let sources = [];
    if (Array.isArray(req.body.sources) && req.body.sources.length) {
      const addressedToMe = { submittedTo: me._id };
      const addressedToMyFunction = HR_PANEL_ROLES.includes(me.role)
        ? { kind: "team_update" }
        : ADMIN_ROLES.includes(me.role)
          ? { kind: "hr_report" }
          : null;

      sources = await Report.find({
        _id: { $in: req.body.sources },
        status: { $ne: "draft" },
        $or: [addressedToMe, ...(addressedToMyFunction ? [addressedToMyFunction] : [])],
      }).distinct("_id");
    }

    const doc = existing || new Report({ kind: target.kind, author: me._id });

    Object.assign(doc, {
      kind: target.kind,
      title,
      summary: String(req.body.summary || "").trim(),
      highlights: lines(req.body.highlights),
      blockers: lines(req.body.blockers),
      metrics: req.body.metrics && typeof req.body.metrics === "object" ? req.body.metrics : {},
      author: me._id,
      authorName: me.name,
      authorRole: me.role,
      department: target.chain.department,
      team: target.chain.team?._id,
      year,
      month,
      sources,
      status: req.body.draft ? "draft" : "submitted",
    });

    // Addressed to one person, except an HR report, which goes to whoever is
    // administering the company rather than to a name
    if (target.to) {
      doc.submittedTo = target.to._id;
      doc.submittedToName = target.to.name;
    } else {
      doc.submittedTo = undefined;
      doc.submittedToName = target.groupName;
    }

    await doc.save();

    if (doc.status === "submitted") {
      // The ones underneath are now part of something; the chain is what lets
      // the reader open them
      if (sources.length) {
        await Report.updateMany({ _id: { $in: sources } }, { $set: { rolledInto: doc._id } });
      }

      const recipients = target.to ? [target.to._id] : target.group;
      notifyUsers(recipients, {
        type: "general",
        title: `${REPORT_CHAIN[target.kind].from} report from ${me.name}`,
        message: title,
        link:
          target.kind === "hr_report"
            ? "/admin/reports/chain"
            : target.kind === "team_update"
              ? "/hr/reports"
              : "/operation-manager/reports",
      });

      logActivity(req, {
        action: "created",
        entity: "Report",
        entityId: doc._id,
        message: `${me.name} submitted a ${target.kind.replace(/_/g, " ")} — "${title}"`,
      });
    }

    return res.status(existing ? 200 : 201).json({
      message: doc.status === "draft" ? "Saved as a draft" : "Sent",
      item: shape(doc),
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("submitReport error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------- reading and answering */

/**
 * PUT /reports/:id/review    { note }
 * PUT /reports/:id/respond   { note }
 *
 * Two acts, deliberately separate. Acknowledging that you read somebody's week
 * is not the same as answering the question in it, and a report that was read
 * and never answered is the exact complaint this whole chain exists to fix —
 * so the dashboards can count them apart.
 */
const act = (field) => async (req, res) => {
  try {
    const me = actorOf(req);
    const report = await Report.findById(req.params.id).populate("author", "name");

    if (!report) return res.status(404).json({ message: "Report not found" });
    if (report.status === "draft") {
      return res.status(409).json({ message: "That report has not been sent yet" });
    }

    const toMe = String(report.submittedTo || "") === String(me._id);
    const isAdmin = ADMIN_ROLES.includes(me.role);
    // Addressed to a function rather than a name — see the inbox for why
    const toMyFunction =
      (report.kind === "hr_report" && isAdmin) ||
      (report.kind === "team_update" && HR_PANEL_ROLES.includes(me.role));

    if (!toMe && !toMyFunction) {
      return res.status(403).json({ message: "That report was not sent to you" });
    }

    const note = String(req.body.note || "").trim();
    if (field === "response" && !note) {
      return res.status(400).json({ message: "Write your response first" });
    }

    report[field] = { by: me._id, byName: me.name, byRole: me.role, note, at: new Date() };
    // Responding implies having read it; reviewing does not imply an answer
    report.status = field === "response" ? "responded" : "reviewed";

    await report.save();

    notifyUser(report.author?._id || report.author, {
      type: "general",
      title:
        field === "response"
          ? `${me.name} answered your report`
          : `${me.name} read your report`,
      message: note || report.title,
    });

    logActivity(req, {
      action: "updated",
      entity: "Report",
      entityId: report._id,
      message: `${me.name} ${field === "response" ? "answered" : "reviewed"} "${report.title}"`,
    });

    return res.status(200).json({
      message: field === "response" ? "Response sent" : "Marked as read",
      item: shape(report),
    });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Report not found" });
    console.error(`report ${field} error:`, err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const reviewReport = act("review");
export const respondToReport = act("response");

/** DELETE /reports/:id — only your own, and only before anybody has read it. */
export const withdrawReport = async (req, res) => {
  try {
    const me = actorOf(req);
    const report = await Report.findOne({ _id: req.params.id, author: me._id });

    if (!report) return res.status(404).json({ message: "That is not your report" });
    if (["reviewed", "responded"].includes(report.status)) {
      return res.status(409).json({ message: "It has already been read — you cannot withdraw it" });
    }

    await report.deleteOne();
    return res.status(200).json({ message: "Withdrawn" });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Not found" });
    console.error("withdrawReport error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------- department performance */

/**
 * GET /reports/departments
 *
 * How each department is doing, side by side.
 *
 * Sales and Operations are separate departments with separate managers and
 * teams, so the only figures worth showing are per department — a single
 * company-wide number hides the thing somebody opened the page to find out.
 */
export const departmentPerformance = async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;

    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59, 999);

    const teams = await Team.find({ ...ACTIVE_TEAM })
      .populate("manager", "name email designation")
      .sort({ kind: 1, name: 1 });

    const byDepartment = {};

    for (const team of teams) {
      const memberIds = team.everyone();

      const [taskRows, reports] = await Promise.all([
        Task.aggregate([
          {
            $match: {
              $or: [{ team: team._id }, { assignedTo: { $in: memberIds.map((id) => id) } }],
              updatedAt: { $gte: from, $lte: to },
            },
          },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        Report.find({ team: team._id, year, month }).select("kind status blockers"),
      ]);

      const tasks = {};
      taskRows.forEach((row) => {
        tasks[row._id] = row.count;
      });

      const total = Object.values(tasks).reduce((sum, n) => sum + n, 0);
      const completed = tasks.completed || 0;

      const entry = byDepartment[team.kind] || {
        department: team.kind,
        teams: [],
        headcount: 0,
        tasks: 0,
        completed: 0,
        blockers: 0,
        reportsFiled: 0,
        reportsAnswered: 0,
      };

      entry.teams.push({
        _id: team._id,
        name: team.name,
        manager: team.manager ? { _id: team.manager._id, name: team.manager.name } : null,
        headcount: memberIds.length,
        tasks: total,
        completed,
        completionRate: total ? Math.round((completed / total) * 100) : 0,
        reportsFiled: reports.length,
        blockers: reports.reduce((sum, r) => sum + (r.blockers?.length || 0), 0),
      });

      entry.headcount += memberIds.length;
      entry.tasks += total;
      entry.completed += completed;
      entry.blockers += reports.reduce((sum, r) => sum + (r.blockers?.length || 0), 0);
      entry.reportsFiled += reports.length;
      entry.reportsAnswered += reports.filter((r) => r.status === "responded").length;

      byDepartment[team.kind] = entry;
    }

    const departments = Object.values(byDepartment).map((entry) => ({
      ...entry,
      completionRate: entry.tasks ? Math.round((entry.completed / entry.tasks) * 100) : 0,
      // What proportion of what was filed actually got an answer — the number
      // that says whether the chain is working rather than just being used
      answerRate: entry.reportsFiled
        ? Math.round((entry.reportsAnswered / entry.reportsFiled) * 100)
        : 0,
    }));

    /** Who is missing. A department with no manager has nobody to report. */
    const unstaffed = teams.filter((team) => !team.manager).map((team) => team.name);

    return res.status(200).json({
      period: { year, month },
      departments,
      unstaffed,
      totals: {
        teams: teams.length,
        headcount: departments.reduce((sum, d) => sum + d.headcount, 0),
        reportsFiled: departments.reduce((sum, d) => sum + d.reportsFiled, 0),
        blockers: departments.reduce((sum, d) => sum + d.blockers, 0),
      },
    });
  } catch (err) {
    console.error("departmentPerformance error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /reports/org
 *
 * The chain as it actually stands, so somebody can see where it is broken —
 * a team with no manager, a member with nobody above them, a company with no
 * HR account. All three are real and all three silently stop reports.
 */
export const orgChart = async (req, res) => {
  try {
    const me = actorOf(req);
    const chain = await chainFor(me);

    const [teams, hrAccounts, admins, unattached] = await Promise.all([
      Team.find({ ...ACTIVE_TEAM })
        .populate("manager", "name email role designation")
        .populate("operationsManagers", "name role")
        .populate("members", "name role")
        .sort({ kind: 1, name: 1 }),
      User.find({ role: { $in: ["hr", "hr_manager"] }, status: "active" }).select("name email role"),
      User.find({ role: { $in: ADMIN_ROLES }, status: "active" }).select("name email role"),
      // Employees on no team and reporting to nobody — invisible to the chain
      User.find({
        role: { $in: ["employee", "operations_manager"] },
        status: "active",
        $or: [{ reportsTo: { $exists: false } }, { reportsTo: null }],
      }).select("name email role designation"),
    ]);

    const onATeam = new Set(
      teams.flatMap((team) => team.everyone().map(String))
    );

    return res.status(200).json({
      admins,
      hr: hrAccounts,
      departments: teams.map((team) => ({
        _id: team._id,
        name: team.name,
        kind: team.kind,
        manager: team.manager,
        operationsManagers: team.operationsManagers,
        members: team.members,
        headcount: team.everyone().length,
      })),
      /**
       * The gaps, named. A report cannot travel through a missing link, and
       * the person who would notice is the person who never receives it.
       */
      gaps: {
        teamsWithoutManager: teams.filter((t) => !t.manager).map((t) => t.name),
        noHrAccount: hrAccounts.length === 0,
        unattached: unattached
          .filter((person) => !onATeam.has(String(person._id)))
          .map((person) => ({ _id: person._id, name: person.name, role: person.role })),
      },
      you: {
        department: chain.department,
        team: chain.team,
        manager: chain.manager,
        hr: chain.hr,
        isTeamManager: chain.isTeamManager,
      },
    });
  } catch (err) {
    console.error("orgChart error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
