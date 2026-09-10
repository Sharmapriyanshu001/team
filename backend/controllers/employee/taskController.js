import Task from "../../models/Task.js";
import Project from "../../models/Project.js";
import WorkLog from "../../models/WorkLog.js";
import Attendance from "../../models/Attendance.js";
import { logActivity } from "../../utils/activity.js";
import { notifyUser } from "../../utils/notify.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const POPULATE = [
  { path: "project", select: "name code status operationsManager" },
  // Department work carries a team instead of a project, and the row has to
  // say which — otherwise it arrives looking like a task with nothing behind it
  { path: "team", select: "name kind" },
  { path: "assignedBy", select: "name designation" },
];

const withRefs = (query) => POPULATE.reduce((q, p) => q.populate(p), query);

const dayStart = (value) => {
  const d = value ? new Date(value) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// An employee may move their own work forward, but only an operations manager can
// declare it finished — "completed" is set by the review flow.
const ALLOWED_STATUS = ["pending", "in_progress", "review"];

// GET /api/employee/tasks
export const listTasks = async (req, res) => {
  try {
    const query = { assignedTo: req.employee._id };

    if (req.query.status && req.query.status !== "all") query.status = req.query.status;
    if (req.query.priority && req.query.priority !== "all") query.priority = req.query.priority;
    if (req.query.project && req.query.project !== "all") query.project = req.query.project;

    // "Pending" in the sidebar means everything still open, not just untouched
    if (req.query.view === "open") query.status = { $in: ["pending", "in_progress"] };

    if (req.query.due === "today" || req.query.due === "overdue") {
      const today = dayStart();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      if (req.query.due === "today") query.dueDate = { $gte: today, $lt: tomorrow };
      else {
        query.dueDate = { $lt: today };
        query.status = { $ne: "completed" };
      }
    }

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [{ title: regex }, { description: regex }];
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 25);

    const [items, total] = await Promise.all([
      withRefs(Task.find(query))
        .sort({ dueDate: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Task.countDocuments(query),
    ]);

    return res.status(200).json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error("employee listTasks error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------- the red dot */

// GET /api/employee/tasks/new-count
export const countNewTasks = async (req, res) => {
  try {
    const count = await Task.countDocuments({
      assignedTo: req.employee._id,
      seenByAssignee: false,
    });
    return res.status(200).json({ count });
  } catch (err) {
    console.error("employee countNewTasks error:", err);
    return res.status(200).json({ count: 0 });
  }
};

// PUT /api/employee/tasks/seen  -> clears the dot once they have looked
export const markTasksSeen = async (req, res) => {
  try {
    await Task.updateMany(
      { assignedTo: req.employee._id, seenByAssignee: false },
      { $set: { seenByAssignee: true } }
    );
    return res.status(200).json({ count: 0 });
  } catch (err) {
    console.error("employee markTasksSeen error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/employee/tasks/:id  -> the "Task Details" screen
export const getTask = async (req, res) => {
  try {
    const task = await withRefs(
      Task.findOne({ _id: req.params.id, assignedTo: req.employee._id })
    );

    if (!task) return res.status(404).json({ message: "Task not found" });

    const [project, siblings] = await Promise.all([
      task.project
        ? Project.findById(task.project._id)
            .populate("client", "name company")
            .populate("operationsManager", "name email designation")
        : null,
      Task.find({
        project: task.project?._id,
        _id: { $ne: task._id },
      })
        .populate("assignedTo", "name")
        .sort({ dueDate: 1 })
        .limit(8),
    ]);

    return res.status(200).json({ task, project, siblings });
  } catch (err) {
    console.error("employee getTask error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/employee/tasks/:id  { status }
export const updateTaskStatus = async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, assignedTo: req.employee._id });
    if (!task) return res.status(404).json({ message: "Task not found" });

    const { status, note, progress } = req.body;

    /**
     * Progress on its own is a legitimate update.
     *
     * "I got another day into this" is the commonest thing anybody has to say
     * about a task, and it moves no status — the work was in progress
     * yesterday and is in progress now. Requiring a status with it would mean
     * either re-sending the one it already has, or not reporting at all, and
     * the second is what actually happens.
     */
    const movingStatus = status !== undefined;
    const movingProgress = progress !== undefined;

    if (!movingStatus && !movingProgress) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    if (movingStatus && !ALLOWED_STATUS.includes(status)) {
      return res.status(400).json({
        message: "You can move a task to pending, in progress or review — only your operations manager can complete it",
      });
    }

    const wasStatus = task.status;
    const wasProgress = task.progress;

    if (movingStatus) task.status = status;

    if (movingProgress) {
      const next = Math.min(100, Math.max(0, Math.round(Number(progress) || 0)));
      task.progress = next;

      /**
       * Reporting work done on an untouched task starts it.
       *
       * Otherwise a task sits at "pending, 40%", which is a state no screen
       * can render honestly and no report can count. Only from pending, and
       * only upward — nothing here ever pulls a task back out of review.
       */
      if (!movingStatus && next > 0 && task.status === "pending") {
        task.status = "in_progress";
      }
    }

    if (note !== undefined) task.reviewNote = note;
    // Acting on a task is the clearest possible sign it has been seen
    task.seenByAssignee = true;
    await task.save();

    logActivity(req, {
      action: "updated",
      entity: "Task",
      entityId: task._id,
      message:
        task.status !== wasStatus
          ? `${req.employee.name} moved "${task.title}" to ${task.status.replace(/_/g, " ")}`
          : `${req.employee.name} put "${task.title}" at ${task.progress}% (was ${wasProgress}%)`,
    });

    // Submitting for review is the one transition the leader must see
    if (task.status === "review" && wasStatus !== "review") {
      const project = await Project.findById(task.project).select("name operationsManager");
      if (project?.operationsManager) {
        notifyUser(project.operationsManager, {
          type: "review",
          title: "Work submitted for review",
          message: `${req.employee.name} finished "${task.title}"`,
          link: "/operation-manager/daily-review",
        });
      }
    }

    const item = await withRefs(Task.findById(task._id));
    return res.status(200).json({ message: "Task updated", item });
  } catch (err) {
    console.error("employee updateTaskStatus error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------- daily work */

// GET /api/employee/daily-work?date=YYYY-MM-DD
export const getDailyWork = async (req, res) => {
  try {
    const day = dayStart(req.query.date);
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);

    const [dueToday, inProgress, overdue, submitted, log, attendance] = await Promise.all([
      withRefs(
        Task.find({
          assignedTo: req.employee._id,
          dueDate: { $gte: day, $lt: nextDay },
        })
      ).sort({ priority: -1 }),
      withRefs(Task.find({ assignedTo: req.employee._id, status: "in_progress" })).sort({
        dueDate: 1,
      }),
      withRefs(
        Task.find({
          assignedTo: req.employee._id,
          status: { $ne: "completed" },
          dueDate: { $lt: day },
        })
      ).sort({ dueDate: 1 }),
      withRefs(
        Task.find({ assignedTo: req.employee._id, status: "review" })
      ).sort({ updatedAt: -1 }),
      WorkLog.findOne({ employee: req.employee._id, date: day }).populate("tasks", "title"),
      Attendance.findOne({ employee: req.employee._id, date: day }),
    ]);

    return res.status(200).json({
      date: day,
      dueToday,
      inProgress,
      overdue,
      submitted,
      log,
      attendance: attendance
        ? { status: attendance.status, checkIn: attendance.checkIn, checkOut: attendance.checkOut }
        : null,
    });
  } catch (err) {
    console.error("employee getDailyWork error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/employee/daily-work  { date, hours, summary, blockers, tasks }
export const saveDailyWork = async (req, res) => {
  try {
    const day = dayStart(req.body.date);
    const { hours, summary, blockers, tasks } = req.body;

    if (!summary || !summary.trim()) {
      return res.status(400).json({ message: "Write a short summary of what you did" });
    }

    const hoursValue = Number(hours) || 0;
    if (hoursValue < 0 || hoursValue > 24) {
      return res.status(400).json({ message: "Hours must be between 0 and 24" });
    }

    // Only tasks actually assigned to this employee may be attached
    const ownTaskIds = Array.isArray(tasks) && tasks.length
      ? await Task.find({ _id: { $in: tasks }, assignedTo: req.employee._id }).distinct("_id")
      : [];

    const log = await WorkLog.findOneAndUpdate(
      { employee: req.employee._id, date: day },
      {
        $set: {
          hours: hoursValue,
          summary: summary.trim(),
          blockers: (blockers || "").trim(),
          tasks: ownTaskIds,
        },
      },
      { new: true, upsert: true, runValidators: true }
    ).populate("tasks", "title");

    logActivity(req, {
      action: "updated",
      entity: "Work Log",
      entityId: log._id,
      message: `${req.employee.name} logged ${hoursValue}h for ${day.toDateString()}`,
    });

    // Blockers are worth interrupting the operations manager for
    if (log.blockers && req.employee.reportsTo) {
      notifyUser(req.employee.reportsTo, {
        type: "task",
        title: `${req.employee.name} reported a blocker`,
        message: log.blockers.slice(0, 120),
        link: "/operation-manager/daily-review",
      });
    }

    return res.status(200).json({ message: "Work log saved", log });
  } catch (err) {
    console.error("employee saveDailyWork error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/employee/daily-submit
 * { date, hours, blockers, summary, entries: [{ task, done, remark }] }
 *
 * The end-of-day submission: every task the employee was given for the day is
 * marked done or not done in one go. "Done" means submitted for review — only
 * the operations manager closes a task — and "not done" carries the reason forward.
 * The day's work log is written from the same submission.
 */
export const submitDailyWork = async (req, res) => {
  try {
    const day = dayStart(req.body.date);
    const { hours, blockers, summary, entries } = req.body;

    if (!Array.isArray(entries) || !entries.length) {
      return res.status(400).json({ message: "Mark at least one task done or not done" });
    }

    const hoursValue = Number(hours) || 0;
    if (hoursValue < 0 || hoursValue > 24) {
      return res.status(400).json({ message: "Hours must be between 0 and 24" });
    }

    // A reason is what makes an unfinished task useful to the leader
    const missingReason = entries.find((entry) => !entry.done && !(entry.remark || "").trim());
    if (missingReason) {
      return res.status(400).json({ message: "Write a reason for every task you could not finish" });
    }

    // Only the employee's own tasks, and never ones the leader already closed
    const tasks = await Task.find({
      _id: { $in: entries.map((entry) => entry.task) },
      assignedTo: req.employee._id,
    });

    if (!tasks.length) {
      return res.status(404).json({ message: "None of those tasks are assigned to you" });
    }

    const byId = new Map(tasks.map((task) => [String(task._id), task]));
    const done = [];
    const pending = [];

    for (const entry of entries) {
      const task = byId.get(String(entry.task));
      if (!task || task.status === "completed") continue;

      task.reviewNote = (entry.remark || "").trim();

      if (entry.done) {
        task.status = "review";
        done.push(task);
      } else {
        // Anything still open is work in flight, not untouched work
        task.status = "in_progress";
        pending.push(task);
      }

      await task.save();
    }

    const autoSummary = [
      `${done.length} of ${done.length + pending.length} tasks done.`,
      ...done.map((task) => `Done: ${task.title}`),
      ...pending.map((task) => `Pending: ${task.title} — ${task.reviewNote}`),
    ].join("\n");

    const log = await WorkLog.findOneAndUpdate(
      { employee: req.employee._id, date: day },
      {
        $set: {
          hours: hoursValue,
          summary: (summary || "").trim() || autoSummary,
          blockers: (blockers || "").trim(),
          tasks: [...done, ...pending].map((task) => task._id),
        },
      },
      { new: true, upsert: true, runValidators: true }
    ).populate("tasks", "title status");

    logActivity(req, {
      action: "updated",
      entity: "Work Log",
      entityId: log._id,
      message: `${req.employee.name} submitted ${day.toDateString()} — ${done.length} done, ${pending.length} pending`,
    });

    // One notification for the whole day, not one per task
    if (req.employee.reportsTo) {
      notifyUser(req.employee.reportsTo, {
        type: done.length ? "review" : "task",
        title: `${req.employee.name} submitted today's work`,
        message: `${done.length} done, ${pending.length} still open${
          log.blockers ? ` · blocker: ${log.blockers.slice(0, 80)}` : ""
        }`,
        link: "/operation-manager/daily-review",
      });
    }

    return res.status(200).json({
      message: `Submitted — ${done.length} sent for review, ${pending.length} carried forward`,
      counts: { done: done.length, pending: pending.length },
      log,
    });
  } catch (err) {
    console.error("employee submitDailyWork error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ----------------------------------------------------------- work history */

// GET /api/employee/history?from=&to=
export const getWorkHistory = async (req, res) => {
  try {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    to.setHours(23, 59, 59, 999);
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getFullYear(), to.getMonth() - 1, 1);
    from.setHours(0, 0, 0, 0);

    const range = { $gte: from, $lte: to };

    const [logs, completed, attendanceRows, dailyRows] = await Promise.all([
      WorkLog.find({ employee: req.employee._id, date: range })
        .populate("tasks", "title")
        .sort({ date: -1 }),
      withRefs(
        Task.find({
          assignedTo: req.employee._id,
          status: "completed",
          completedAt: range,
        })
      ).sort({ completedAt: -1 }),
      Attendance.aggregate([
        { $match: { employee: req.employee._id, date: range } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      WorkLog.find({ employee: req.employee._id, date: range }).select("date hours"),
    ]);

    const totalHours = logs.reduce((sum, log) => sum + (log.hours || 0), 0);
    const ratings = completed.filter((t) => t.reviewRating > 0).map((t) => t.reviewRating);

    return res.status(200).json({
      range: { from, to },
      summary: {
        daysLogged: logs.length,
        totalHours: Number(totalHours.toFixed(1)),
        avgHours: logs.length ? Number((totalHours / logs.length).toFixed(1)) : 0,
        tasksCompleted: completed.length,
        avgRating: ratings.length
          ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1))
          : 0,
      },
      attendance: attendanceRows.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {}),
      hoursByDay: dailyRows
        .map((row) => ({
          date: row.date,
          label: new Date(row.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
          hours: row.hours,
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date)),
      logs,
      completed,
    });
  } catch (err) {
    console.error("employee getWorkHistory error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
