import User from "../../models/User.js";
import Project from "../../models/Project.js";
import Task from "../../models/Task.js";
import Issue from "../../models/Issue.js";
import Notification from "../../models/Notification.js";
import { getScope } from "../../middleware/leaderAuth.js";

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
    return { key: `${d.getFullYear()}-${d.getMonth() + 1}`, label: MONTH_LABELS[d.getMonth()], start: d };
  });
};

const countsToObject = (rows) =>
  rows.reduce((acc, row) => {
    acc[row._id || "unknown"] = row.count;
    return acc;
  }, {});

// GET /api/leader/dashboard
export const getDashboard = async (req, res) => {
  try {
    const { projectIds, teamIds } = await getScope(req);
    const buckets = monthBuckets(6);
    const since = buckets[0].start;

    const inMyProjects = { project: { $in: projectIds } };

    const [
      projects,
      tasksByStatus,
      tasksDonePerMonth,
      openIssues,
      issuesBySeverity,
      teamMembers,
      workloadRows,
      pendingReviews,
      upcoming,
      notifications,
      overdueCount,
    ] = await Promise.all([
      Project.find({ _id: { $in: projectIds } })
        .populate("client", "name company")
        .sort({ endDate: 1 }),

      Task.aggregate([
        { $match: inMyProjects },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      Task.aggregate([
        { $match: { ...inMyProjects, status: "completed", completedAt: { $gte: since } } },
        {
          $group: {
            _id: { y: localYear("$completedAt"), m: localMonth("$completedAt") },
            count: { $sum: 1 },
          },
        },
      ]),

      Issue.countDocuments({ ...inMyProjects, status: { $in: ["open", "in_progress"] } }),
      Issue.aggregate([
        { $match: inMyProjects },
        { $group: { _id: "$severity", count: { $sum: 1 } } },
      ]),

      User.find({ _id: { $in: teamIds } }).select("name designation status"),

      Task.aggregate([
        { $match: { assignedTo: { $in: teamIds } } },
        {
          $group: {
            _id: "$assignedTo",
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
            pending: {
              $sum: { $cond: [{ $in: ["$status", ["pending", "in_progress"]] }, 1, 0] },
            },
          },
        },
      ]),

      Task.find({ ...inMyProjects, status: "review" })
        .populate("assignedTo", "name")
        .populate("project", "name code")
        .sort({ updatedAt: -1 })
        .limit(6),

      Task.find({
        ...inMyProjects,
        status: { $ne: "completed" },
        dueDate: { $ne: null },
      })
        .populate("assignedTo", "name")
        .populate("project", "name")
        .sort({ dueDate: 1 })
        .limit(6),

      Notification.find({ user: req.leader._id }).sort({ createdAt: -1 }).limit(6),

      (() => {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        return Task.countDocuments({
          ...inMyProjects,
          status: { $ne: "completed" },
          dueDate: { $lt: startOfToday },
        });
      })(),
    ]);

    const monthMap = tasksDonePerMonth.reduce((acc, row) => {
      acc[`${row._id.y}-${row._id.m}`] = row.count;
      return acc;
    }, {});

    const statusCounts = countsToObject(tasksByStatus);
    const tasksTotal = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
    const tasksCompleted = statusCounts.completed || 0;

    const memberById = teamMembers.reduce((acc, m) => {
      acc[String(m._id)] = m;
      return acc;
    }, {});

    return res.status(200).json({
      stats: {
        projects: projects.length,
        // Same definition the "Active Projects" screen uses, so the two agree
        activeProjects: projects.filter((p) =>
          ["planning", "in_progress", "on_hold"].includes(p.status)
        ).length,
        completedProjects: projects.filter((p) =>
          ["completed", "cancelled"].includes(p.status)
        ).length,
        teamSize: teamMembers.length,
        tasksTotal,
        tasksCompleted,
        tasksPending: (statusCounts.pending || 0) + (statusCounts.in_progress || 0),
        tasksInReview: statusCounts.review || 0,
        overdueTasks: overdueCount,
        openIssues,
        completionRate: tasksTotal ? Math.round((tasksCompleted / tasksTotal) * 100) : 0,
        avgProgress: projects.length
          ? Math.round(projects.reduce((sum, p) => sum + (p.progress || 0), 0) / projects.length)
          : 0,
      },
      charts: {
        monthlyTrend: buckets.map((b) => ({
          month: b.label,
          tasksCompleted: monthMap[b.key] || 0,
        })),
        tasksByStatus: statusCounts,
        issuesBySeverity: countsToObject(issuesBySeverity),
        projectProgress: projects.map((p) => ({
          name: p.name,
          progress: p.progress,
          status: p.status,
        })),
        teamWorkload: workloadRows.map((row) => ({
          name: memberById[String(row._id)]?.name || "Unknown",
          completed: row.completed,
          pending: row.pending,
        })),
      },
      recent: {
        projects: projects.slice(0, 5),
        pendingReviews,
        upcoming,
        notifications,
      },
    });
  } catch (err) {
    console.error("leader getDashboard error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
