import Project from "../../models/Project.js";
import Task from "../../models/Task.js";
import Issue from "../../models/Issue.js";
import Attendance from "../../models/Attendance.js";
import WorkLog from "../../models/WorkLog.js";
import Notification from "../../models/Notification.js";
import User from "../../models/User.js";
import { getScope } from "../../middleware/employeeAuth.js";
import { onTimeSplit } from "../../utils/staffRollup.js";

const countsToObject = (rows) =>
  rows.reduce((acc, row) => ({ ...acc, [row._id || "unknown"]: row.count }), {});

/**
 * "high" belongs above "medium" above "low" — which is not the order the
 * database gives. Mongo compares these as strings, so a descending sort puts
 * medium first and high last, and the one list meant to answer "what do I do
 * now" led with the wrong task. Ranked here instead, where the order is said
 * out loud.
 */
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

const byPriorityThenDue = (a, b) => {
  const rank = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  if (rank !== 0) return rank;
  return new Date(a.dueDate || 0) - new Date(b.dueDate || 0);
};

/** How far back the activity feed looks, in days. */
const ACTIVITY_DAYS = 14;

// GET /api/employee/dashboard
export const getDashboard = async (req, res) => {
  try {
    const { projectIds, leaderId } = await getScope(req);
    const me = req.employee._id;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const activitySince = new Date(today.getTime() - ACTIVITY_DAYS * 86400000);

    const [
      projects,
      tasksByStatus,
      dueToday,
      overdueCount,
      upcoming,
      myIssues,
      attendanceRows,
      weekLogs,
      notifications,
      unreadNotifications,
      leader,
      ratingRows,
      timing,
      priorityTasks,
      doneToday,
      wasAssigned,
      wasSubmitted,
      wasCompleted,
      logsWritten,
    ] = await Promise.all([
      Project.find({ _id: { $in: projectIds } })
        .populate("client", "name company")
        .populate("operationsManager", "name")
        .sort({ endDate: 1 }),

      Task.aggregate([
        { $match: { assignedTo: me } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      /**
       * Work still owed today. Completed tasks are excluded on purpose: this
       * number is the red card, and a red card that counts finished work tells
       * an employee they are behind when they are not.
       */
      Task.find({
        assignedTo: me,
        status: { $ne: "completed" },
        dueDate: { $gte: today, $lt: tomorrow },
      })
        .populate("project", "name code")
        .sort({ dueDate: 1 }),

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

      /**
       * The unread ones on their own, for the strip at the top of the screen.
       *
       * The list above is "the last six things that happened" and is mostly
       * already-seen news by the time it is read. What belongs above the fold
       * is the shorter question: is there anything here I have not dealt with
       * yet. Same collection, and the {user, read, createdAt} index already
       * covers this exact shape.
       */
      Notification.find({ user: me, read: false }).sort({ createdAt: -1 }).limit(5),

      leaderId ? User.findById(leaderId).select("name email designation") : null,

      Task.aggregate([
        { $match: { assignedTo: me, status: "completed", reviewRating: { $gt: 0 } } },
        { $group: { _id: null, avg: { $avg: "$reviewRating" }, count: { $sum: 1 } } },
      ]),

      /**
       * How much of the finished work landed by its due date. Counted by the
       * same helper the admin and HR profile drawers use, so the employee is
       * reading the same number their manager is.
       */
      onTimeSplit({ assignedTo: me }),

      /**
       * What to do now: everything still open that is due today or already
       * late. Overdue work belongs here rather than in a separate card — a
       * task that was due yesterday is not less urgent for having been missed,
       * and an employee who only sees "due today" never sees it again at all.
       */
      Task.find({ assignedTo: me, status: { $ne: "completed" }, dueDate: { $lt: tomorrow } })
        .populate("project", "name")
        .limit(25),

      Task.find({
        assignedTo: me,
        status: "completed",
        completedAt: { $gte: today, $lt: tomorrow },
      })
        .populate("project", "name")
        .sort({ completedAt: -1 })
        .limit(4),

      /* ------------------------------------------- the activity feed's sources
       *
       * Read from the tasks and logs themselves rather than from the
       * notifications table, because the notifications card sits on this same
       * screen: sourcing both from one place would print every line twice.
       * These also cover what the employee did, which they are never notified
       * about and which is half of what "what happened" means.
       */
      Task.find({ assignedTo: me, createdAt: { $gte: activitySince } })
        .populate("assignedBy", "name")
        .select("title assignedBy createdAt")
        .sort({ createdAt: -1 })
        .limit(10),

      Task.find({ assignedTo: me, status: "review", updatedAt: { $gte: activitySince } })
        .select("title updatedAt")
        .sort({ updatedAt: -1 })
        .limit(10),

      Task.find({ assignedTo: me, status: "completed", completedAt: { $gte: activitySince } })
        .select("title completedAt reviewRating")
        .sort({ completedAt: -1 })
        .limit(10),

      WorkLog.find({ employee: me, createdAt: { $gte: activitySince } })
        .select("date hours createdAt")
        .sort({ createdAt: -1 })
        .limit(10),
    ]);

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

    const taskLink = (id) => `/employee/tasks/details?id=${id}`;

    /**
     * One feed out of four sources. Each row carries the time it happened so
     * they can be interleaved; whoever renders it only sorts and prints.
     */
    const activity = [
      ...wasAssigned.map((task) => ({
        id: `assigned-${task._id}`,
        kind: "assigned",
        at: task.createdAt,
        text: `${task.assignedBy?.name || "Your manager"} assigned you a new task`,
        detail: task.title,
        link: taskLink(task._id),
      })),
      ...wasSubmitted.map((task) => ({
        id: `submitted-${task._id}`,
        kind: "submitted",
        at: task.updatedAt,
        text: "You submitted work for review",
        detail: task.title,
        link: taskLink(task._id),
      })),
      ...wasCompleted.map((task) => ({
        id: `completed-${task._id}`,
        kind: task.reviewRating > 0 ? "reviewed" : "completed",
        at: task.completedAt,
        text:
          task.reviewRating > 0
            ? `Your operations manager reviewed your task — ${task.reviewRating}/5`
            : "Task completed",
        detail: task.title,
        link: taskLink(task._id),
      })),
      ...logsWritten.map((log) => ({
        id: `log-${log._id}`,
        kind: "log",
        at: log.createdAt,
        text: "You submitted your daily work log",
        detail: log.hours ? `${log.hours} h logged` : "",
        link: "/employee/history",
      })),
    ]
      .filter((row) => row.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 8);

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
        tasksNotStarted: statusCounts.pending || 0,
        tasksInProgress: statusCounts.in_progress || 0,
        tasksInReview: statusCounts.review || 0,
        dueToday: dueToday.length,
        overdueTasks: overdueCount,
        openIssues: myIssues,
        completionRate: tasksTotal ? Math.round((tasksCompleted / tasksTotal) * 100) : 0,
        // tasksOnTime / tasksLate / onTimeRate — onTimeRate is null, not 0,
        // when nothing has had a deadline to be judged against yet.
        ...timing,
        attendanceRate: attendanceDays
          ? Math.round(((attendance.present || 0) / attendanceDays) * 100)
          : 0,
        avgRating: Number((ratingRows[0]?.avg || 0).toFixed(1)),
        ratedTasks: ratingRows[0]?.count || 0,
      },
      charts: {
        tasksByStatus: statusCounts,
        attendanceThisMonth: attendance,
        hoursByDay,
      },
      recent: {
        projects: projects.slice(0, 5),
        dueToday,
        priority: priorityTasks.sort(byPriorityThenDue).slice(0, 6),
        doneToday,
        upcoming,
        notifications,
        unreadNotifications,
        activity,
      },
      leader,
    });
  } catch (err) {
    console.error("employee getDashboard error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
