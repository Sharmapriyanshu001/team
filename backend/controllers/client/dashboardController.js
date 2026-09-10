import Project from "../../models/Project.js";
import Task from "../../models/Task.js";
import Issue from "../../models/Issue.js";
import FileDoc from "../../models/FileDoc.js";
import Meeting from "../../models/Meeting.js";
import Feedback from "../../models/Feedback.js";
import Notification from "../../models/Notification.js";
import { getScope } from "../../middleware/clientAuth.js";

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

const countsToObject = (rows) =>
  rows.reduce((acc, row) => ({ ...acc, [row._id || "unknown"]: row.count }), {});

// GET /api/client/dashboard
export const getDashboard = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);
    const buckets = monthBuckets(6);
    const since = buckets[0].start;
    const now = new Date();

    const [
      projects,
      tasksByStatus,
      donePerMonth,
      openIssues,
      files,
      meetings,
      feedbackStats,
      notifications,
    ] = await Promise.all([
      Project.find({ _id: { $in: projectIds } })
        .populate("operationsManager", "name designation email")
        .sort({ endDate: 1 }),

      Task.aggregate([
        { $match: { project: { $in: projectIds } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      Task.aggregate([
        {
          $match: {
            project: { $in: projectIds },
            status: "completed",
            completedAt: { $gte: since },
          },
        },
        {
          $group: {
            _id: { y: localYear("$completedAt"), m: localMonth("$completedAt") },
            count: { $sum: 1 },
          },
        },
      ]),

      Issue.countDocuments({
        project: { $in: projectIds },
        status: { $in: ["open", "in_progress"] },
      }),

      FileDoc.countDocuments({
        $or: [{ client: req.client._id }, { project: { $in: projectIds } }],
      }),

      Meeting.find({ client: req.client._id })
        .populate("project", "name code")
        .populate("organizer", "name designation")
        .sort({ scheduledAt: 1 }),

      Feedback.aggregate([
        { $match: { client: req.client._id } },
        { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
      ]),

      Notification.find({ user: req.client._id, userModel: "Client" })
        .sort({ createdAt: -1 })
        .limit(6),
    ]);

    const monthMap = donePerMonth.reduce(
      (acc, row) => ({ ...acc, [`${row._id.y}-${row._id.m}`]: row.count }),
      {}
    );

    const statusCounts = countsToObject(tasksByStatus);
    const tasksTotal = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
    const tasksCompleted = statusCounts.completed || 0;

    const upcomingMeetings = meetings.filter(
      (m) => m.status === "scheduled" && m.scheduledAt >= now
    );

    return res.status(200).json({
      stats: {
        projects: projects.length,
        activeProjects: projects.filter((p) =>
          ["planning", "in_progress", "on_hold"].includes(p.status)
        ).length,
        completedProjects: projects.filter((p) =>
          ["completed", "cancelled"].includes(p.status)
        ).length,
        avgProgress: projects.length
          ? Math.round(projects.reduce((sum, p) => sum + (p.progress || 0), 0) / projects.length)
          : 0,
        tasksTotal,
        tasksCompleted,
        completionRate: tasksTotal ? Math.round((tasksCompleted / tasksTotal) * 100) : 0,
        openIssues,
        files,
        upcomingMeetings: upcomingMeetings.length,
        pendingRequests: meetings.filter((m) => m.status === "requested").length,
        avgRating: Number((feedbackStats[0]?.avg || 0).toFixed(1)),
        feedbackCount: feedbackStats[0]?.count || 0,
      },
      charts: {
        monthlyTrend: buckets.map((b) => ({
          month: b.label,
          tasksCompleted: monthMap[b.key] || 0,
        })),
        tasksByStatus: statusCounts,
        projectProgress: projects.map((p) => ({
          name: p.name,
          progress: p.progress,
          status: p.status,
        })),
      },
      recent: {
        projects: projects.slice(0, 5),
        meetings: upcomingMeetings.slice(0, 4),
        notifications,
      },
    });
  } catch (err) {
    console.error("client getDashboard error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
