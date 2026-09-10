import Project from "../models/Project.js";
import Task from "../models/Task.js";
import Issue from "../models/Issue.js";
import FileDoc from "../models/FileDoc.js";
import WorkLog from "../models/WorkLog.js";

/**
 * GET /api/admin/projects/:id/details
 *
 * Everything the admin's project drawer shows: who owns it, the work board,
 * what is waiting for a sign-off, open issues, documents, and the daily logs
 * the team has been filing against it.
 */

/** Midnight today, for "is this overdue". */
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * How far along the work actually is.
 *
 * `Project.progress` is a number somebody typed into the create form, and
 * nothing in the app has ever recalculated it. On this database nine of the
 * ten projects disagree with their own task board — one reads 62% with a
 * single task of five finished, another reads 38% with nothing finished at
 * all — and that same figure is what the client sees in their portal.
 *
 * So both numbers are returned, named for what they are. `recorded` is what
 * was typed and what everyone is shown; `actual` is what the tasks say. The
 * admin is shown the two side by side and decides — silently overwriting a
 * client-facing number would be the app making a business decision on their
 * behalf.
 *
 * `actual` is null, not zero, when there are no tasks: a project nobody has
 * broken into work yet is unmeasured, which is a different thing from a
 * project that is measured at nothing.
 */
const measureProgress = (tasks) => {
  const completed = tasks.filter((task) => task.status === "completed").length;

  return {
    recorded: null, // filled in by the caller from the project record
    actual: tasks.length ? Math.round((completed / tasks.length) * 100) : null,
    completed,
    total: tasks.length,
  };
};

/**
 * What each person on the project has actually done.
 *
 * The drawer could show the task list and leave the admin to count, which is
 * what "who is carrying this project" currently costs them. This answers it
 * directly: per person, what they hold, what they finished, what is late, and
 * how many hours they have logged against it.
 *
 * Everybody on the project appears, including somebody with nothing assigned
 * — a member with a row of zeroes is a finding, and dropping them because
 * they have no tasks is how that stays invisible.
 */
const contributionsFor = ({ project, tasks, logs }) => {
  const today = startOfToday();

  const people = new Map();

  const seat = (person, role) => {
    const id = String(person?._id || person || "");
    if (!id) return null;
    if (!people.has(id)) {
      people.set(id, {
        _id: id,
        name: person?.name || "Unknown",
        designation: person?.designation || "",
        role,
        assigned: 0,
        completed: 0,
        open: 0,
        inReview: 0,
        overdue: 0,
        hours: 0,
        lastActivity: null,
      });
    }
    return people.get(id);
  };

  if (project.operationsManager) seat(project.operationsManager, "Operations Manager");
  (project.members || []).forEach((member) => seat(member, "Member"));

  for (const task of tasks) {
    // Work handed to somebody who is no longer on the project still counts —
    // it is on the board, and hiding it would make the totals disagree with
    // the task list right beside them.
    const row = seat(task.assignedTo, "Off the project");
    if (!row) continue;

    row.assigned += 1;
    if (task.status === "completed") row.completed += 1;
    else if (task.status === "review") row.inReview += 1;
    else row.open += 1;

    if (task.status !== "completed" && task.dueDate && new Date(task.dueDate) < today) {
      row.overdue += 1;
    }

    const touched = task.completedAt || task.updatedAt;
    if (touched && (!row.lastActivity || new Date(touched) > new Date(row.lastActivity))) {
      row.lastActivity = touched;
    }
  }

  for (const log of logs) {
    const row = seat(log.employee, "Member");
    if (!row) continue;
    row.hours += log.hours || 0;
    if (!row.lastActivity || new Date(log.date) > new Date(row.lastActivity)) {
      row.lastActivity = log.date;
    }
  }

  return [...people.values()]
    .map((row) => ({ ...row, hours: Number(row.hours.toFixed(1)) }))
    .sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));
};

export const projectDetails = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate("client", "name company email phone")
      .populate("operationsManager", "name email designation phone")
      .populate("members", "name email designation department reportsTo")
      // Who put each member on it and when — written by the leader's assign
      // flow, and now by the admin's too
      .populate("memberAssignments.user", "name designation")
      // What this job continues from, so whoever opens it can see what was
      // built before without going looking for it
      .populate("previousProject", "name code status progress endDate");

    if (!project) return res.status(404).json({ message: "Project not found" });

    /**
     * And what continues from it. The link is stored one way — a project
     * points backwards — so the jobs that followed have to be asked for.
     * Reading the history in both directions is the point of recording it.
     */
    const followedBy = await Project.find({ previousProject: project._id })
      .select("name code status progress startDate")
      .sort({ createdAt: 1 });

    const memberIds = (project.members || []).map((m) => m._id);
    // The leader files work against the project too, and leaving them out of
    // the hours made a one-person project look like nobody had touched it
    const workedBy = [...memberIds, project.operationsManager?._id].filter(Boolean);

    const [tasks, issues, files, logs] = await Promise.all([
      Task.find({ project: project._id })
        .populate("assignedTo", "name designation")
        .populate("assignedBy", "name")
        .sort({ dueDate: 1, createdAt: -1 }),
      Issue.find({ project: project._id })
        .populate("assignedTo", "name")
        .populate("raisedBy", "name")
        .sort({ createdAt: -1 }),
      FileDoc.find({ project: project._id })
        .select("title category fileType createdAt")
        .sort({ createdAt: -1 })
        .limit(8),
      /**
       * A month, not a week.
       *
       * Seven days answers "is anybody on this right now", which is worth
       * knowing and is not what somebody opening a project drawer is usually
       * asking. A month is long enough to see whether a project has been
       * worked on at all, which is the question a stalled project needs.
       */
      WorkLog.find({ employee: { $in: workedBy }, date: { $gte: daysAgo(30) } })
        .populate("employee", "name designation")
        .populate("tasks", "title status")
        .sort({ date: -1 })
        .limit(60),
    ]);

    const byStatus = tasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {});

    const today = startOfToday();

    const progress = measureProgress(tasks);
    progress.recorded = project.progress ?? 0;
    // Worth saying out loud rather than leaving the reader to compare two
    // numbers — this is the whole reason both are here
    progress.matches = progress.actual === null || progress.actual === progress.recorded;

    const weekAgo = daysAgo(7);

    return res.status(200).json({
      project,
      // The jobs on either side of this one, read from the stored link
      followedBy,
      tasks,
      issues,
      files,
      logs,
      progress,
      contributions: contributionsFor({ project, tasks, logs }),
      stats: {
        tasksTotal: tasks.length,
        pending: byStatus.pending || 0,
        inProgress: byStatus.in_progress || 0,
        // The number that matters on this screen — work awaiting a sign-off
        inReview: byStatus.review || 0,
        completed: byStatus.completed || 0,
        overdue: tasks.filter(
          (task) => task.status !== "completed" && task.dueDate && new Date(task.dueDate) < today
        ).length,
        unassigned: tasks.filter((task) => !task.assignedTo).length,
        openIssues: issues.filter((issue) => ["open", "in_progress"].includes(issue.status)).length,
        members: memberIds.length,
        hoursThisWeek: Number(
          logs
            .filter((log) => new Date(log.date) >= weekAgo)
            .reduce((sum, log) => sum + (log.hours || 0), 0)
            .toFixed(1)
        ),
        hoursThisMonth: Number(
          logs.reduce((sum, log) => sum + (log.hours || 0), 0).toFixed(1)
        ),
        // When anybody last did anything on it — the figure that says whether
        // a project is moving, which no count of open tasks can
        lastActivity:
          [
            ...logs.map((log) => log.date),
            ...tasks.map((task) => task.completedAt || task.updatedAt),
          ]
            .filter(Boolean)
            .sort((a, b) => new Date(b) - new Date(a))[0] || null,
      },
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "Project not found" });
    }
    console.error("projectDetails error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
