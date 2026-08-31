import User from "../models/User.js";
import Client from "../models/Client.js";
import Project from "../models/Project.js";
import Task from "../models/Task.js";
import Issue from "../models/Issue.js";
import Attendance from "../models/Attendance.js";
import ActivityLog from "../models/ActivityLog.js";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// $year / $month read timestamps in UTC by default, which would push anything
// created in the first hours of a month into the previous one.
const TZ = process.env.APP_TIMEZONE || "Asia/Kolkata";
const localYear = (field) => ({ $year: { date: field, timezone: TZ } });
const localMonth = (field) => ({ $month: { date: field, timezone: TZ } });

// Last `count` months as [{ key: "2026-3", label: "Mar", year, month }]
const monthBuckets = (count) => {
  const now = new Date();
  const buckets = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${d.getMonth() + 1}`,
      label: MONTH_LABELS[d.getMonth()],
      start: d,
    });
  }
  return buckets;
};

// Turn a $group result keyed by {_id: {y, m}} into a lookup map
const byMonthMap = (rows) =>
  rows.reduce((acc, row) => {
    acc[`${row._id.y}-${row._id.m}`] = row.count;
    return acc;
  }, {});

const countsToObject = (rows) =>
  rows.reduce((acc, row) => {
    acc[row._id || "unknown"] = row.count;
    return acc;
  }, {});

// GET /api/admin/dashboard
export const getDashboard = async (req, res) => {
  try {
    const buckets = monthBuckets(6);
    const since = buckets[0].start;
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [
      clients,
      activeClients,
      teamLeaders,
      employees,
      projects,
      activeProjects,
      completedProjects,
      tasksTotal,
      tasksCompleted,
      tasksPending,
      openIssues,
      projectsByStatus,
      tasksByStatus,
      issuesBySeverity,
      projectsPerMonth,
      tasksDonePerMonth,
      attendanceThisMonth,
      budgetAgg,
      topPerformersRaw,
      recentProjects,
      recentTasks,
      recentActivity,
    ] = await Promise.all([
      Client.countDocuments(),
      Client.countDocuments({ status: "active" }),
      User.countDocuments({ role: "team_leader" }),
      User.countDocuments({ role: "employee" }),
      Project.countDocuments(),
      Project.countDocuments({ status: "in_progress" }),
      Project.countDocuments({ status: "completed" }),
      Task.countDocuments(),
      Task.countDocuments({ status: "completed" }),
      Task.countDocuments({ status: { $in: ["pending", "in_progress"] } }),
      Issue.countDocuments({ status: { $in: ["open", "in_progress"] } }),

      Project.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Task.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Issue.aggregate([{ $group: { _id: "$severity", count: { $sum: 1 } } }]),

      Project.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { y: localYear("$createdAt"), m: localMonth("$createdAt") },
            count: { $sum: 1 },
          },
        },
      ]),
      Task.aggregate([
        { $match: { status: "completed", completedAt: { $gte: since } } },
        {
          $group: {
            _id: { y: localYear("$completedAt"), m: localMonth("$completedAt") },
            count: { $sum: 1 },
          },
        },
      ]),

      Attendance.aggregate([
        { $match: { date: { $gte: monthStart } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      Project.aggregate([
        { $group: { _id: null, total: { $sum: "$budget" } } },
      ]),

      Task.aggregate([
        { $match: { status: "completed", assignedTo: { $ne: null } } },
        { $group: { _id: "$assignedTo", completed: { $sum: 1 } } },
        { $sort: { completed: -1 } },
        { $limit: 5 },
      ]),

      Project.find()
        .populate("client", "name company")
        .populate("teamLeader", "name")
        .sort({ createdAt: -1 })
        .limit(5),
      Task.find()
        .populate("assignedTo", "name")
        .populate("project", "name")
        .sort({ createdAt: -1 })
        .limit(6),
      ActivityLog.find().sort({ createdAt: -1 }).limit(8),
    ]);

    const projectsMap = byMonthMap(projectsPerMonth);
    const tasksMap = byMonthMap(tasksDonePerMonth);

    const monthlyTrend = buckets.map((b) => ({
      month: b.label,
      projects: projectsMap[b.key] || 0,
      tasksCompleted: tasksMap[b.key] || 0,
    }));

    const topPerformerIds = topPerformersRaw.map((r) => r._id);
    const performerDocs = await User.find({ _id: { $in: topPerformerIds } }).select(
      "name role designation"
    );
    const performerById = performerDocs.reduce((acc, u) => {
      acc[u._id.toString()] = u;
      return acc;
    }, {});

    const topPerformers = topPerformersRaw.map((row) => {
      const user = performerById[row._id.toString()];
      return {
        id: row._id,
        name: user?.name || "Unknown",
        designation: user?.designation || user?.role || "",
        completed: row.completed,
      };
    });

    return res.status(200).json({
      stats: {
        clients,
        activeClients,
        teamLeaders,
        employees,
        projects,
        activeProjects,
        completedProjects,
        tasksTotal,
        tasksCompleted,
        tasksPending,
        openIssues,
        totalBudget: budgetAgg[0]?.total || 0,
        completionRate: tasksTotal
          ? Math.round((tasksCompleted / tasksTotal) * 100)
          : 0,
      },
      charts: {
        monthlyTrend,
        projectsByStatus: countsToObject(projectsByStatus),
        tasksByStatus: countsToObject(tasksByStatus),
        issuesBySeverity: countsToObject(issuesBySeverity),
        attendanceThisMonth: countsToObject(attendanceThisMonth),
        topPerformers,
      },
      recent: {
        projects: recentProjects,
        tasks: recentTasks,
        activity: recentActivity,
      },
    });
  } catch (err) {
    console.error("getDashboard error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
