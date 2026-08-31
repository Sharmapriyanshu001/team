import User from "../models/User.js";
import Client from "../models/Client.js";
import Project from "../models/Project.js";
import Task from "../models/Task.js";
import Issue from "../models/Issue.js";
import Attendance from "../models/Attendance.js";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const TZ = process.env.APP_TIMEZONE || "Asia/Kolkata";
const localYear = (field) => ({ $year: { date: field, timezone: TZ } });
const localMonth = (field) => ({ $month: { date: field, timezone: TZ } });

const monthBuckets = (count) => {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1);
    return {
      key: `${d.getFullYear()}-${d.getMonth() + 1}`,
      label: MONTH_LABELS[d.getMonth()],
      start: d,
    };
  });
};

const byMonth = (rows) =>
  rows.reduce((acc, row) => ({ ...acc, [`${row._id.y}-${row._id.m}`]: row }), {});

const countsToObject = (rows) =>
  rows.reduce((acc, row) => ({ ...acc, [row._id || "unknown"]: row.count }), {});

const keyBy = (docs) => docs.reduce((acc, doc) => ({ ...acc, [String(doc._id)]: doc }), {});

/* ---------------------------------------------------------------- clients */

const clientsInsight = async () => {
  const buckets = monthBuckets(6);

  const [clients, byStatus, projectRows, issueRows, newPerMonth] = await Promise.all([
    Client.find().select("-password").sort({ createdAt: -1 }),
    Client.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Project.aggregate([
      { $match: { client: { $ne: null } } },
      {
        $group: {
          _id: "$client",
          projects: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          budget: { $sum: "$budget" },
          avgProgress: { $avg: "$progress" },
        },
      },
    ]),
    Project.aggregate([
      { $match: { client: { $ne: null } } },
      {
        $lookup: {
          from: "issues",
          localField: "_id",
          foreignField: "project",
          as: "issues",
        },
      },
      { $unwind: "$issues" },
      { $match: { "issues.status": { $in: ["open", "in_progress"] } } },
      { $group: { _id: "$client", count: { $sum: 1 } } },
    ]),
    Client.aggregate([
      { $match: { createdAt: { $gte: buckets[0].start } } },
      {
        $group: {
          _id: { y: localYear("$createdAt"), m: localMonth("$createdAt") },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const stats = keyBy(projectRows);
  const issues = countsToObject(issueRows);
  const monthly = byMonth(newPerMonth);

  const rows = clients.map((client) => {
    const s = stats[String(client._id)] || { projects: 0, completed: 0, budget: 0, avgProgress: 0 };
    return {
      id: client._id,
      name: client.name,
      company: client.company,
      email: client.email,
      phone: client.phone,
      status: client.status,
      portalAccess: client.portalAccess,
      lastLogin: client.lastLogin,
      createdAt: client.createdAt,
      projects: s.projects,
      completed: s.completed,
      budget: s.budget,
      avgProgress: Math.round(s.avgProgress || 0),
      openIssues: issues[String(client._id)] || 0,
    };
  });

  return {
    title: "Clients",
    subtitle: "Everyone you are delivering for, and what they have with you",
    summary: [
      { label: "Total clients", value: clients.length },
      { label: "Active", value: clients.filter((c) => c.status === "active").length },
      { label: "With a live project", value: rows.filter((r) => r.projects > 0).length },
      { label: "Portal enabled", value: clients.filter((c) => c.portalAccess).length },
    ],
    byStatus: countsToObject(byStatus),
    trend: buckets.map((b) => ({ month: b.label, value: monthly[b.key]?.count || 0 })),
    trendLabel: "New clients",
    rows: rows.sort((a, b) => b.budget - a.budget),
  };
};

/* --------------------------------------------------------------- projects */

const projectsInsight = async () => {
  const buckets = monthBuckets(6);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [projects, byStatus, byPriority, taskRows, newPerMonth] = await Promise.all([
    Project.find()
      .populate("client", "name company")
      .populate("teamLeader", "name designation")
      .sort({ endDate: 1 }),
    Project.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Project.aggregate([{ $group: { _id: "$priority", count: { $sum: 1 } } }]),
    Task.aggregate([
      {
        $group: {
          _id: "$project",
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        },
      },
    ]),
    Project.aggregate([
      { $match: { createdAt: { $gte: buckets[0].start } } },
      {
        $group: {
          _id: { y: localYear("$createdAt"), m: localMonth("$createdAt") },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const tasks = keyBy(taskRows);
  const monthly = byMonth(newPerMonth);

  const rows = projects.map((project) => {
    const t = tasks[String(project._id)] || { total: 0, completed: 0 };
    const end = project.endDate ? new Date(project.endDate) : null;

    return {
      id: project._id,
      name: project.name,
      code: project.code,
      client: project.client?.company || project.client?.name || "—",
      leader: project.teamLeader?.name || "Unassigned",
      status: project.status,
      priority: project.priority,
      progress: project.progress,
      budget: project.budget,
      startDate: project.startDate,
      endDate: project.endDate,
      tasks: t.total,
      tasksCompleted: t.completed,
      overdue: Boolean(end && end < today && project.status !== "completed"),
    };
  });

  const active = rows.filter((r) =>
    ["planning", "in_progress", "on_hold"].includes(r.status)
  ).length;

  return {
    title: "Projects",
    subtitle: "Every project on the books, with its stage and progress",
    summary: [
      { label: "Total projects", value: projects.length },
      { label: "Active", value: active },
      { label: "Delivered", value: rows.filter((r) => r.status === "completed").length },
      { label: "Past deadline", value: rows.filter((r) => r.overdue).length },
    ],
    byStatus: countsToObject(byStatus),
    byPriority: countsToObject(byPriority),
    trend: buckets.map((b) => ({ month: b.label, value: monthly[b.key]?.count || 0 })),
    trendLabel: "New projects",
    rows,
  };
};

/* ------------------------------------------------------------------- team */

const teamInsight = async () => {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [staff, taskRows, attendanceRows, projectRows] = await Promise.all([
    User.find({ role: { $in: ["team_leader", "employee"] } })
      .select("-password")
      .populate("reportsTo", "name")
      .sort({ role: 1, name: 1 }),
    Task.aggregate([
      { $match: { assignedTo: { $ne: null } } },
      {
        $group: {
          _id: "$assignedTo",
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        },
      },
    ]),
    Attendance.aggregate([
      { $match: { date: { $gte: monthStart } } },
      {
        $group: {
          _id: "$employee",
          days: { $sum: 1 },
          present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
        },
      },
    ]),
    Project.aggregate([
      { $match: { teamLeader: { $ne: null } } },
      { $group: { _id: "$teamLeader", projects: { $sum: 1 } } },
    ]),
  ]);

  const tasks = keyBy(taskRows);
  const attendance = keyBy(attendanceRows);
  const led = keyBy(projectRows);

  const rows = staff.map((person) => {
    const key = String(person._id);
    const t = tasks[key] || { total: 0, completed: 0 };
    const a = attendance[key] || { days: 0, present: 0 };

    return {
      id: person._id,
      name: person.name,
      email: person.email,
      phone: person.phone,
      role: person.role,
      designation: person.designation,
      department: person.department,
      status: person.status,
      reportsTo: person.reportsTo?.name || "—",
      joiningDate: person.joiningDate,
      projectsLed: led[key]?.projects || 0,
      tasks: t.total,
      tasksCompleted: t.completed,
      completionRate: t.total ? Math.round((t.completed / t.total) * 100) : 0,
      attendanceRate: a.days ? Math.round((a.present / a.days) * 100) : 0,
    };
  });

  const departments = rows.reduce((acc, person) => {
    const dept = person.department || "Unassigned";
    acc[dept] = (acc[dept] || 0) + 1;
    return acc;
  }, {});

  return {
    title: "Team Members",
    subtitle: "Team leaders and employees, with their workload and attendance",
    summary: [
      { label: "Total people", value: rows.length },
      { label: "Team leaders", value: rows.filter((r) => r.role === "team_leader").length },
      { label: "Employees", value: rows.filter((r) => r.role === "employee").length },
      { label: "Active", value: rows.filter((r) => r.status === "active").length },
    ],
    byStatus: rows.reduce((acc, r) => ({ ...acc, [r.role]: (acc[r.role] || 0) + 1 }), {}),
    byDepartment: departments,
    rows,
  };
};

/* ----------------------------------------------------------------- budget */

const budgetInsight = async () => {
  const buckets = monthBuckets(6);

  const [projects, byStatus, perMonth] = await Promise.all([
    Project.find()
      .populate("client", "name company")
      .populate("teamLeader", "name")
      .sort({ budget: -1 }),
    Project.aggregate([
      { $group: { _id: "$status", budget: { $sum: "$budget" }, count: { $sum: 1 } } },
    ]),
    Project.aggregate([
      { $match: { createdAt: { $gte: buckets[0].start } } },
      {
        $group: {
          _id: { y: localYear("$createdAt"), m: localMonth("$createdAt") },
          budget: { $sum: "$budget" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const monthly = byMonth(perMonth);
  const total = projects.reduce((sum, p) => sum + (p.budget || 0), 0);

  // What share of the money sits behind work that is already delivered
  const delivered = projects
    .filter((p) => p.status === "completed")
    .reduce((sum, p) => sum + (p.budget || 0), 0);

  const byClient = projects.reduce((acc, project) => {
    const name = project.client?.company || project.client?.name || "No client";
    acc[name] = (acc[name] || 0) + (project.budget || 0);
    return acc;
  }, {});

  return {
    title: "Total Budget",
    subtitle: "Where the contracted value sits across projects and clients",
    money: true,
    summary: [
      { label: "Contracted value", value: total, money: true },
      { label: "Delivered", value: delivered, money: true },
      { label: "In progress", value: total - delivered, money: true },
      {
        label: "Average per project",
        value: projects.length ? Math.round(total / projects.length) : 0,
        money: true,
      },
    ],
    byStatus: byStatus.reduce((acc, row) => ({ ...acc, [row._id]: row.budget }), {}),
    byClient,
    trend: buckets.map((b) => ({ month: b.label, value: monthly[b.key]?.budget || 0 })),
    trendLabel: "Budget booked",
    rows: projects.map((project) => ({
      id: project._id,
      name: project.name,
      code: project.code,
      client: project.client?.company || project.client?.name || "—",
      leader: project.teamLeader?.name || "Unassigned",
      status: project.status,
      progress: project.progress,
      budget: project.budget,
      endDate: project.endDate,
    })),
  };
};

const BUILDERS = {
  clients: clientsInsight,
  projects: projectsInsight,
  team: teamInsight,
  budget: budgetInsight,
};

// GET /api/admin/insights/:metric
export const getInsight = async (req, res) => {
  try {
    const build = BUILDERS[req.params.metric];
    if (!build) return res.status(404).json({ message: "Unknown metric" });

    return res.status(200).json(await build());
  } catch (err) {
    console.error(`insight ${req.params.metric} error:`, err);
    return res.status(500).json({ message: "Server error" });
  }
};
