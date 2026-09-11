import Report, { REPORT_CHAIN } from "../models/Report.js";
import Task from "../models/Task.js";
import Team, { ACTIVE_TEAM } from "../models/Team.js";
import User, { ADMIN_ROLES, HR_PANEL_ROLES } from "../models/User.js";

import { logActivity } from "../utils/activity.js";
import { notifyUser, notifyUsers } from "../utils/notify.js";
import {
  chainFor,
  reportRecipientsFor,
  reportTargetFor,
  reportsToMe,
} from "../utils/hierarchy.js";

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

/**
 * The functions one person staffs.
 *
 * A report addressed to HR carries no recipient id — it belongs to whoever
 * is doing the HR job today — so every inbox and every permission check needs
 * the same answer to "is that me". Written once here, because three copies of
 * this is three places for somebody to quietly lose access to their own post.
 */
const functionsOf = (user) => {
  const groups = [];
  if (ADMIN_ROLES.includes(user.role)) groups.push("admins");
  if (HR_PANEL_ROLES.includes(user.role)) groups.push("hr");
  if (user.role === "operations_manager") groups.push("operations");
  return groups;
};

/** Is this report addressed to me, by name or by function? */
const addressedToMe = (report, user) => {
  if (String(report.submittedTo?._id || report.submittedTo || "") === String(user._id)) return true;

  // The old shape: kinds that have always had exactly one destination
  if (report.kind === "hr_report" && ADMIN_ROLES.includes(user.role)) return true;
  if (report.kind === "team_update" && HR_PANEL_ROLES.includes(user.role)) return true;

  return Boolean(report.submittedToGroup) && functionsOf(user).includes(report.submittedToGroup);
};

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
    const { options } = await reportRecipientsFor(me);

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
      /**
       * Where it can go. More than one for a team member, who chooses between
       * the person above them and HR; exactly one for everybody else, whose
       * step up the chain is not a matter of opinion.
       */
      recipients: options.map(({ key, label, name, count }) => ({ key, label, name, count })),

      // Kept for anything still reading a single destination: the default one
      goesTo: options[0] ? { name: options[0].name, count: options[0].count } : null,

      /**
       * Only true when the company has nobody to report to at all — no
       * manager, no operations manager, no HR, no admin. Being on no team
       * used to be enough to set this, which left the people most in need of
       * saying something with no way to say it.
       */
      blocked: !options.length,
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
     * Everything addressed to me, by name or by function.
     *
     * An administrator's inbox is every HR report and an HR account's inbox is
     * every team update — not only the ones carrying their id. Both are
     * functions several people staff, and addressing one of them by id would
     * make the report invisible to the others.
     *
     * The `kind` clauses are the original chain — every HR report is the
     * administrators', every team update is HR's. The `submittedToGroup`
     * clause is what a team member choosing to write to HR produces: a
     * member update that belongs in HR's inbox and matches none of the
     * kind rules.
     */
    const addressed = [{ submittedTo: me._id }];

    if (isAdmin) addressed.push({ kind: "hr_report" });
    if (isHr) addressed.push({ kind: "team_update" });

    const groups = functionsOf(me);
    if (groups.length) addressed.push({ submittedToGroup: { $in: groups } });

    const query = { status: { $ne: "draft" }, $or: addressed };

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
    const isAdmin = ADMIN_ROLES.includes(me.role);
    const toMe = addressedToMe(report, me);

    /**
     * Or it sits underneath something addressed to me. That is what makes
     * drilling from a summary down to the week behind a figure work at all —
     * HR reading a team update can open the member updates it summarises.
     */
    let viaParent = false;
    if (!mine && !toMe && !isAdmin && report.rolledInto) {
      const parent = await Report.findById(report.rolledInto).select(
        "submittedTo submittedToGroup kind"
      );
      viaParent = Boolean(parent) && addressedToMe(parent, me);
    }

    if (!mine && !toMe && !isAdmin && !viaParent) {
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
    const { options } = await reportRecipientsFor(me);

    if (!options.length) {
      return res.status(409).json({
        message: "There is nobody set up to receive reports yet",
      });
    }

    /**
     * The client sends a key — "manager" or "hr" — and never an id. Which
     * people that key means is worked out here from the chain, so a request
     * cannot address a report to somebody who is not above the author.
     *
     * An unknown or missing key falls back to the first option, which is the
     * ordinary step up the chain.
     */
    const chosen =
      options.find((o) => o.key === String(req.body.recipient || "")) || options[0];

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

    /**
     * Addressed to a name when the choice resolved to one person, and to a
     * function when it resolved to several. The function is written down
     * rather than inferred from the kind — see Report.submittedToGroup.
     */
    if (!chosen.group && chosen.ids.length === 1) {
      doc.submittedTo = chosen.ids[0];
      doc.submittedToName = chosen.name;
      doc.submittedToGroup = undefined;
    } else {
      doc.submittedTo = undefined;
      doc.submittedToName = chosen.name;
      doc.submittedToGroup = chosen.group || undefined;
    }

    await doc.save();

    if (doc.status === "submitted") {
      // The ones underneath are now part of something; the chain is what lets
      // the reader open them
      if (sources.length) {
        await Report.updateMany({ _id: { $in: sources } }, { $set: { rolledInto: doc._id } });
      }

      const recipients = chosen.ids;
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

    if (!addressedToMe(report, me)) {
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

    const [teams, hrAccounts, admins, staff] = await Promise.all([
      Team.find({ ...ACTIVE_TEAM })
        .populate("manager", "name email role designation")
        .populate("operationsManagers", "name role")
        .populate("members", "name role")
        .sort({ kind: 1, name: 1 }),
      User.find({ role: { $in: ["hr", "hr_manager"] }, status: "active" }).select("name email role"),
      User.find({ role: { $in: ADMIN_ROLES }, status: "active" }).select("name email role"),
      /**
       * Every member of staff, with whoever they report to.
       *
       * This used to fetch only the people who reported to nobody, which made
       * the chart unable to see the case it most needed to: somebody given a
       * manager but never added to a team. They dropped out of "reports to
       * nobody" and were on no team either, so they appeared nowhere at all —
       * changing a reporting line made a person vanish from the org chart.
       */
      User.find({
        role: { $in: ["employee", "operations_manager"] },
        status: "active",
      })
        .select("name email role designation reportsTo")
        .populate("reportsTo", "name role")
        .sort({ name: 1 }),
    ]);

    const onATeam = new Set(
      teams.flatMap((team) => team.everyone().map(String))
    );

    /**
     * Everybody the teams do not account for, split by whether the chain can
     * still reach them.
     *
     * A reporting line and a team are two different facts, and setting one
     * has never set the other — Reporting Lines writes `reportsTo`, the teams
     * screen writes membership. Somebody can therefore have a manager and no
     * team, which is a perfectly ordinary state and used to be an invisible
     * one. They are listed under their manager instead of being dropped.
     */
    const offTeam = staff.filter((person) => !onATeam.has(String(person._id)));

    const brief = (person) => ({ _id: person._id, name: person.name, role: person.role });

    const underManagers = [];
    const byManager = new Map();

    offTeam
      .filter((person) => person.reportsTo)
      .forEach((person) => {
        const key = String(person.reportsTo._id);
        if (!byManager.has(key)) {
          const entry = { manager: brief(person.reportsTo), people: [] };
          byManager.set(key, entry);
          underManagers.push(entry);
        }
        byManager.get(key).people.push(brief(person));
      });

    const unattached = offTeam.filter((person) => !person.reportsTo).map(brief);

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
        unattached,
      },
      /**
       * On nobody's team, but somebody's report. Kept out of `gaps` because
       * this is not a gap — the chain reaches these people, they simply are
       * not on a team yet.
       */
      underManagers,
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
