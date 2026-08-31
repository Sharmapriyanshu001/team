import Project from "../../models/Project.js";
import Task from "../../models/Task.js";
import Issue from "../../models/Issue.js";
import Attendance from "../../models/Attendance.js";
import WorkLog from "../../models/WorkLog.js";
import Notification from "../../models/Notification.js";
import User from "../../models/User.js";
import { getScope } from "../../middleware/employeeAuth.js";

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

// GET /api/employee/dashboard
export const getDashboard = async (req, res) => {
  try {
    const { projectIds, leaderId } = await getScope(req);
    const me = req.employee._id;

    const buckets = monthBuckets(6);
    const since = buckets[0].start;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      projects,
      tasksByStatus,
      donePerMonth,
      dueToday,
      overdueCount,
      upcoming,
      myIssues,
      attendanceRows,
      weekLogs,
      notifications,
      leader,
      ratingRows,
    ] = await Promise.all([
      Project.find({ _id: { $in: projectIds } })
        .populate("client", "name company")
        .populate("teamLeader", "name")
        .sort({ endDate: 1 }),

      Task.aggregate([
        { $match: { assignedTo: me } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      Task.aggregate([
        { $match: { assignedTo: me, status: "completed", completedAt: { $gte: since } } },
        {
          $group: {
            _id: { y: localYear("$completedAt"), m: localMonth("$completedAt") },
            count: { $sum: 1 },
          },
        },
      ]),

      Task.find({ assignedTo: me, dueDate: { $gte: today, $lt: tomorrow } })
        .populate("project", "name code")
        .sort({ priority: -1 }),

      Task.countDocuments({
        assignedTo: me,
        status: { $ne: "completed" },
        dueDate: { $lt: today },
      }),

      Task.find({ assignedTo: me, status: { $ne: "completed" }, dueDate: { $gte: tomorrow } })
        .populate("project", "name")
        .sort({ dueDate: 1 })
        .limit(6),

      Issue.countDocuments({
        project: { $in: projectIds },
        status: { $in: ["open", "in_progress"] },
      }),

      Attendance.aggregate([
        { $match: { employee: me, date: { $gte: monthStart } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      WorkLog.find({
        employee: me,
        date: { $gte: new Date(today.getTime() - 6 * 86400000) },
      }).select("date hours"),

      Notification.find({ user: me }).sort({ createdAt: -1 }).limit(6),

      leaderId ? User.findById(leaderId).select("name email designation") : null,

      Task.aggregate([
        { $match: { assignedTo: me, status: "completed", reviewRating: { $gt: 0 } } },
        { $group: { _id: null, avg: { $avg: "$reviewRating" }, count: { $sum: 1 } } },
      ]),
    ]);

    const monthMap = donePerMonth.reduce(
      (acc, row) => ({ ...acc, [`${row._id.y}-${row._id.m}`]: row.count }),
      {}
    );

    const statusCounts = countsToObject(tasksByStatus);
    const tasksTotal = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
    const tasksCompleted = statusCounts.completed || 0;

    const attendance = countsToObject(attendanceRows);
    const attendanceDays = Object.values(attendance).reduce((sum, n) => sum + n, 0);

    // Last 7 days of logged hours, zero-filled so the chart has no gaps
    const hoursByDay = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today.getTime() - (6 - i) * 86400000);
      const match = weekLogs.find(
        (log) => new Date(log.date).toDateString() === d.toDateString()
      );
      return {
        label: d.toLocaleDateString("en-IN", { weekday: "short" }),
        hours: match?.hours || 0,
      };
    });

    return res.status(200).json({
      stats: {
        projects: projects.length,
        activeProjects: projects.filter((p) =>
          ["planning", "in_progress", "on_hold"].includes(p.status)
        ).length,
        completedProjects: projects.filter((p) =>
          ["completed", "cancelled"].includes(p.status)
        ).length,
        tasksTotal,
        tasksCompleted,
        tasksPending: (statusCounts.pending || 0) + (statusCounts.in_progress || 0),
        tasksInReview: statusCounts.review || 0,
        dueToday: dueToday.length,
        overdueTasks: overdueCount,
        openIssues: myIssues,
        completionRate: tasksTotal ? Math.round((tasksCompleted / tasksTotal) * 100) : 0,
        attendanceRate: attendanceDays
          ? Math.round(((attendance.present || 0) / attendanceDays) * 100)
          : 0,
        avgRating: Number((ratingRows[0]?.avg || 0).toFixed(1)),
        ratedTasks: ratingRows[0]?.count || 0,
      },
      charts: {
        monthlyTrend: buckets.map((b) => ({
          month: b.label,
          tasksCompleted: monthMap[b.key] || 0,
        })),
        tasksByStatus: statusCounts,
        attendanceThisMonth: attendance,
        hoursByDay,
      },
      recent: {
        projects: projects.slice(0, 5),
        dueToday,
        upcoming,
        notifications,
      },
      leader,
    });
  } catch (err) {
    console.error("employee getDashboard error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
