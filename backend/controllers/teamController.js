import mongoose from "mongoose";

import Team, { ACTIVE_TEAM } from "../models/Team.js";
import Target, { TARGET_METRICS } from "../models/Target.js";
import User from "../models/User.js";
import Task from "../models/Task.js";
import Project from "../models/Project.js";
import Lead from "../models/Lead.js";
import Quotation from "../models/Quotation.js";
import Invoice from "../models/Invoice.js";
import AppRelease from "../models/AppRelease.js";
import Attendance from "../models/Attendance.js";

import { buildCrud, InvalidInput } from "../utils/crud.js";
import { actorOf } from "../utils/actor.js";
import { logActivity } from "../utils/activity.js";
import { notifyUsers } from "../utils/notify.js";

/**
 * Departments, the people in them, and the numbers they have agreed to hit.
 */

/* ------------------------------------------------------------------ helpers */

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

const oid = (value) => new mongoose.Types.ObjectId(String(value));

/** The first and last moment of a given month. */
const monthBounds = (year, month) => ({
  from: new Date(year, month - 1, 1),
  to: new Date(year, month, 0, 23, 59, 59, 999),
});

const metricSpec = (key) => TARGET_METRICS.find((metric) => metric.key === key);

/* ------------------------------------------------------------------- teams */

export const teams = buildCrud(Team, {
  entity: "Team",
  searchFields: ["name", "description"],
  filterFields: ["kind", "active"],
  populate: [
    { path: "manager", select: "name email designation" },
    { path: "operationsManagers", select: "name email designation" },
    { path: "members", select: "name email designation" },
  ],
  sort: { kind: 1, name: 1 },

  beforeSave: async (payload, req, existing) => {
    const data = { ...payload };

    if (data.manager === "") data.manager = null;

    /**
     * The same person on a team twice — once as a leader and once as a member
     * — would be counted twice in every headcount and every average. Leaders
     * are the narrower list, so a duplicate is dropped from members.
     */
    if (data.members !== undefined || data.operationsManagers !== undefined) {
      const leaders = (data.operationsManagers ?? existing?.operationsManagers ?? []).map((id) =>
        String(id._id || id)
      );
      const members = (data.members ?? existing?.members ?? []).map((id) => String(id._id || id));

      data.operationsManagers = leaders;
      data.members = members.filter((id) => !leaders.includes(id));
    }

    /**
     * Whoever opened it, from whichever panel. Was req.admin only, which left
     * createdBy empty on every department HR opens — and an empty creator on
     * a record that exists to say who answers for what is the wrong default.
     */
    if (!existing) data.createdBy = actorOf(req)?._id;

    /**
     * Being made manager or leader of a team is a role in the company, not
     * just a row in a table, so the account's own role is brought into line
     * with it here — in beforeSave, which is awaited, rather than in
     * afterSave, which is deliberately fire-and-forget. A promotion that
     * lands a moment after the response is a promotion the screen does not
     * show until somebody reloads.
     *
     * Nothing is ever demoted: taking somebody off a team should not quietly
     * cost them their access, and an admin who wants that does it on the
     * person rather than as a side effect of editing a team.
     */
    if (data.manager) {
      await User.updateOne(
        { _id: data.manager, role: { $in: ["employee", "operations_manager", "user"] } },
        { role: "manager" }
      );
    }

    if (data.operationsManagers?.length) {
      await User.updateMany(
        { _id: { $in: data.operationsManagers }, role: { $in: ["employee", "user"] } },
        { role: "operations_manager" }
      );
    }

    return data;
  },

  afterSave: (doc, req, { isNew }) => {
    if (isNew) {
      notifyUsers(doc.everyone(), {
        type: "assignment",
        title: `You are on the ${doc.name} team`,
        message: "Your targets and team work show up under Team.",
        link: "/team",
      });
    }
  },
});

/* ----------------------------------------------------------- the counting */

/**
 * What a metric actually reads, for a set of people, in a month.
 *
 * Every branch is a query this app can already answer — which is the whole
 * argument for targets living here rather than in a spreadsheet. A target set
 * on the 1st is correct on the 3rd without anybody totalling anything.
 *
 * `people` is the list a target applies to: one person for a personal target,
 * everybody on the team for a team one.
 */
const measure = async (metric, people, { from, to }) => {
  const ids = people.map(oid);
  if (!ids.length) return 0;

  switch (metric) {
    /* ------------------------------------------------------------- sales */

    case "revenue_closed": {
      const [row] = await Invoice.aggregate([
        {
          $match: {
            createdBy: { $in: ids },
            status: { $ne: "cancelled" },
            issuedOn: { $gte: from, $lte: to },
          },
        },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]);
      return round(row?.total);
    }

    case "payments_collected": {
      const [row] = await Invoice.aggregate([
        { $unwind: "$payments" },
        {
          $match: {
            "payments.recordedBy": { $in: ids },
            "payments.receivedOn": { $gte: from, $lte: to },
          },
        },
        { $group: { _id: null, total: { $sum: "$payments.amount" } } },
      ]);
      return round(row?.total);
    }

    case "leads_won":
      return Lead.countDocuments({ owner: { $in: ids }, stage: "won", wonAt: { $gte: from, $lte: to } });

    case "leads_added":
      return Lead.countDocuments({ owner: { $in: ids }, createdAt: { $gte: from, $lte: to } });

    case "quotations_sent":
      return Quotation.countDocuments({
        createdBy: { $in: ids },
        sentAt: { $gte: from, $lte: to },
      });

    /* -------------------------------------------------------- operations */

    case "tasks_completed":
      return Task.countDocuments({
        assignedTo: { $in: ids },
        status: "completed",
        completedAt: { $gte: from, $lte: to },
      });

    case "projects_delivered":
      return Project.countDocuments({
        $or: [{ operationsManager: { $in: ids } }, { members: { $in: ids } }],
        status: "completed",
        updatedAt: { $gte: from, $lte: to },
      });

    case "releases_shipped":
      return AppRelease.countDocuments({
        createdBy: { $in: ids },
        status: "live",
        liveAt: { $gte: from, $lte: to },
      });

    /* ---------------------------------------------------------------- hr */

    case "attendance_rate": {
      /**
       * Days marked present against days marked at all. Deliberately not
       * against working days in the month: a day nobody marked is a gap in the
       * record, and counting it as an absence would turn a forgotten Friday
       * into a disciplinary number.
       */
      const [row] = await Attendance.aggregate([
        { $match: { employee: { $in: ids }, date: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: null,
            marked: { $sum: 1 },
            present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
          },
        },
      ]);
      if (!row?.marked) return 0;
      return round((row.present / row.marked) * 100);
    }

    default:
      // Everything else is a number a person types — see Target.manualValue
      return null;
  }
};

/**
 * A target with its actual figure filled in and the maths done.
 *
 * Exported so the panels that show somebody their own targets — the Sales
 * dashboard among them — read the same number this screen does. A second
 * implementation would be a second answer to "how are we doing", and the two
 * would disagree the first time either changed.
 */
export const withProgress = async (target, peopleFor) => {
  const spec = metricSpec(target.metric);
  const { from, to } = monthBounds(target.year, target.month);

  let actual = target.manualValue;

  if (spec?.auto) {
    const people = await peopleFor(target);
    const counted = await measure(target.metric, people, { from, to });
    if (counted !== null) actual = counted;
  }

  const percent = target.targetValue ? round((actual / target.targetValue) * 100) : null;

  return {
    ...(target.toObject ? target.toObject() : target),
    label: target.metric === "custom" ? target.customLabel || "Custom" : spec?.label || target.metric,
    unit: spec?.unit || "count",
    auto: Boolean(spec?.auto),
    actual: round(actual),
    percent,
    remaining: round(Math.max(0, target.targetValue - actual)),
    onTrack: percent === null ? null : percent >= expectedByNow(target),
  };
};

/**
 * How far through the month a target ought to be by now, as a percentage.
 *
 * A target at 40% on the 5th is ahead; the same number on the 28th is a
 * problem. Without this every open target reads as behind for most of the
 * month, which is the fastest way to teach people to ignore the colour.
 *
 * A month that has already ended expects 100%.
 */
const expectedByNow = (target) => {
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === target.year && now.getMonth() + 1 === target.month;

  if (!isCurrentMonth) {
    const ended =
      new Date(target.year, target.month, 0, 23, 59, 59, 999).getTime() < now.getTime();
    return ended ? 100 : 0;
  }

  const daysInMonth = new Date(target.year, target.month, 0).getDate();
  return round((now.getDate() / daysInMonth) * 100);
};

/* ----------------------------------------------------------------- targets */

export const listTargets = async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;

    const query = { year, month };
    if (req.query.team && req.query.team !== "all") query.team = req.query.team;
    if (req.query.owner && req.query.owner !== "all") query.owner = req.query.owner;

    const rows = await Target.find(query)
      .populate("team", "name kind")
      .populate("owner", "name email designation")
      .sort({ team: 1, owner: 1 });

    // Team membership is looked up once and shared by every target on it
    const teamCache = new Map();

    const peopleFor = async (target) => {
      if (target.owner) return [String(target.owner._id || target.owner)];
      if (!target.team) return [];

      const key = String(target.team._id || target.team);
      if (!teamCache.has(key)) {
        const team = await Team.findById(key);
        teamCache.set(key, team ? team.everyone() : []);
      }
      return teamCache.get(key);
    };

    const items = await Promise.all(rows.map((row) => withProgress(row, peopleFor)));

    return res.status(200).json({
      period: { year, month },
      items,
      summary: {
        total: items.length,
        hit: items.filter((row) => row.percent !== null && row.percent >= 100).length,
        behind: items.filter((row) => row.onTrack === false).length,
      },
    });
  } catch (err) {
    console.error("listTargets error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const setTarget = async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.body.year) || now.getFullYear();
    const month = Number(req.body.month) || now.getMonth() + 1;

    if (!req.body.team && !req.body.owner) {
      throw new InvalidInput("A target belongs to a team, a person, or both");
    }
    if (!metricSpec(req.body.metric)) {
      throw new InvalidInput("Pick what is being measured");
    }

    const targetValue = Number(req.body.targetValue);
    if (!Number.isFinite(targetValue) || targetValue <= 0) {
      throw new InvalidInput("Set a number above zero to aim at");
    }
    if (req.body.metric === "custom" && !String(req.body.customLabel || "").trim()) {
      throw new InvalidInput("Say what this number actually is");
    }

    const target = await Target.create({
      team: req.body.team || null,
      owner: req.body.owner || null,
      title: req.body.title || "",
      metric: req.body.metric,
      customLabel: req.body.customLabel || "",
      targetValue,
      manualValue: Number(req.body.manualValue) || 0,
      year,
      month,
      setBy: req.admin?._id,
      setByName: req.admin?.name || "",
    });

    logActivity(req, {
      action: "created",
      entity: "Target",
      entityId: target._id,
      message: `Target set: ${req.body.metric} ${targetValue} for ${month}/${year}`,
    });

    if (target.owner) {
      notifyUsers([target.owner], {
        type: "assignment",
        title: "You have a new target",
        message: `${metricSpec(target.metric)?.label || target.metric}: ${targetValue}`,
        link: "/team",
      });
    }

    return res.status(201).json({ message: "Target set", item: target });
  } catch (err) {
    if (err.name === "InvalidInput") return res.status(400).json({ message: err.message });
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: "That target is already set for this month — edit it instead" });
    }
    console.error("setTarget error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateTarget = async (req, res) => {
  try {
    const target = await Target.findById(req.params.id);
    if (!target) return res.status(404).json({ message: "Target not found" });

    if (req.body.targetValue !== undefined) {
      const value = Number(req.body.targetValue);
      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ message: "Set a number above zero to aim at" });
      }
      target.targetValue = value;
    }

    /**
     * Only meaningful for a metric nobody can count. Silently ignored for the
     * automatic ones rather than refused, because a form that sends the whole
     * object should not fail on a field it was never going to use.
     */
    if (req.body.manualValue !== undefined && !metricSpec(target.metric)?.auto) {
      target.manualValue = Number(req.body.manualValue) || 0;
    }

    ["title", "customLabel", "reviewNote"].forEach((field) => {
      if (req.body[field] !== undefined) target[field] = req.body[field];
    });

    if (req.body.status !== undefined) {
      target.status = req.body.status;
      target.closedAt = ["hit", "missed", "cancelled"].includes(req.body.status)
        ? new Date()
        : null;
    }

    await target.save();
    return res.status(200).json({ message: "Target updated", item: target });
  } catch (err) {
    console.error("updateTarget error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const removeTarget = async (req, res) => {
  try {
    const gone = await Target.findByIdAndDelete(req.params.id);
    if (!gone) return res.status(404).json({ message: "Target not found" });
    return res.status(200).json({ message: "Target removed" });
  } catch (err) {
    console.error("removeTarget error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------ team detail */

/**
 * One team: who is on it, how its targets are going, and what its people are
 * carrying right now.
 */
export const teamDetail = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id)
      .populate("manager", "name email designation phone")
      .populate("operationsManagers", "name email designation")
      .populate("members", "name email designation");

    if (!team) return res.status(404).json({ message: "Team not found" });

    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const { from, to } = monthBounds(year, month);

    const everyone = team.everyone();

    const [targetRows, openTasks, doneThisMonth] = await Promise.all([
      Target.find({ year, month, $or: [{ team: team._id }, { owner: { $in: everyone } }] })
        .populate("owner", "name designation")
        .sort({ owner: 1 }),
      Task.find({ assignedTo: { $in: everyone }, status: { $ne: "completed" } })
        .populate("assignedTo", "name")
        .populate("project", "name")
        .sort({ dueDate: 1 })
        .limit(50),
      Task.countDocuments({
        assignedTo: { $in: everyone },
        status: "completed",
        completedAt: { $gte: from, $lte: to },
      }),
    ]);

    const peopleFor = async (target) =>
      target.owner ? [String(target.owner._id || target.owner)] : everyone;

    const targets = await Promise.all(targetRows.map((row) => withProgress(row, peopleFor)));

    /** Each person's own targets, so a manager can see who is carrying what. */
    const byPerson = [
      ...(team.operationsManagers || []),
      ...(team.members || []),
    ].map((person) => {
      const theirs = targets.filter(
        (target) => String(target.owner?._id || target.owner || "") === String(person._id)
      );

      return {
        _id: person._id,
        name: person.name,
        designation: person.designation,
        isLeader: (team.operationsManagers || []).some((leader) => String(leader._id) === String(person._id)),
        targets: theirs,
        openTasks: openTasks.filter(
          (task) => String(task.assignedTo?._id) === String(person._id)
        ).length,
      };
    });

    return res.status(200).json({
      item: team,
      period: { year, month },
      targets: targets.filter((target) => !target.owner),
      people: byPerson,
      work: { open: openTasks.length, completedThisMonth: doneThisMonth, tasks: openTasks },
    });
  } catch (err) {
    console.error("teamDetail error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Every team side by side — the view somebody running the company opens.
 *
 * Leads with how each team's targets are going rather than with headcount,
 * because "Sales is nine people" is not a fact anybody acts on and "Sales is
 * at 40% on the 24th" is.
 */
export const teamsOverview = async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const { from, to } = monthBounds(year, month);

    const all = await Team.find({ ...ACTIVE_TEAM })
      .populate("manager", "name")
      .sort({ kind: 1, name: 1 });

    const rows = await Promise.all(
      all.map(async (team) => {
        const everyone = team.everyone();

        const [targetRows, openTasks, done] = await Promise.all([
          Target.find({ year, month, team: team._id }),
          Task.countDocuments({ assignedTo: { $in: everyone }, status: { $ne: "completed" } }),
          Task.countDocuments({
            assignedTo: { $in: everyone },
            status: "completed",
            completedAt: { $gte: from, $lte: to },
          }),
        ]);

        const targets = await Promise.all(
          targetRows.map((row) => withProgress(row, async () => everyone))
        );

        return {
          _id: team._id,
          name: team.name,
          kind: team.kind,
          manager: team.manager,
          headcount: everyone.length,
          leaderCount: (team.operationsManagers || []).length,
          targets,
          behind: targets.filter((target) => target.onTrack === false).length,
          work: { open: openTasks, completedThisMonth: done },
        };
      })
    );

    return res.status(200).json({
      period: { year, month },
      teams: rows,
      metrics: TARGET_METRICS,
    });
  } catch (err) {
    console.error("teamsOverview error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------- what a team member may see */

/** My team, my targets, my work — for whoever is signed in. */
export const myTeam = async (req, res) => {
  try {
    const user = req.leader || req.employee;

    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;

    const myTeams = await Team.find({
      ...ACTIVE_TEAM,
      $or: [{ manager: user._id }, { operationsManagers: user._id }, { members: user._id }],
    })
      .populate("manager", "name designation")
      .populate("operationsManagers", "name designation")
      .populate("members", "name designation");

    const teamIds = myTeams.map((team) => team._id);

    const targetRows = await Target.find({
      year,
      month,
      $or: [{ owner: user._id }, { team: { $in: teamIds } }],
    })
      .populate("team", "name kind")
      .sort({ owner: -1 });

    const peopleFor = async (target) => {
      if (target.owner) return [String(target.owner)];
      const team = myTeams.find((row) => String(row._id) === String(target.team?._id || target.team));
      return team ? team.everyone() : [];
    };

    const targets = await Promise.all(targetRows.map((row) => withProgress(row, peopleFor)));

    return res.status(200).json({
      period: { year, month },
      teams: myTeams,
      mine: targets.filter((target) => String(target.owner || "") === String(user._id)),
      teamTargets: targets.filter((target) => !target.owner),
    });
  } catch (err) {
    console.error("myTeam error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** The option lists the target form needs. */
export const targetMetrics = (req, res) =>
  res.status(200).json({ metrics: TARGET_METRICS });
