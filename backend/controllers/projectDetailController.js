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
export const projectDetails = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate("client", "name company email phone")
      .populate("teamLeader", "name email designation phone")
      .populate("members", "name email designation department reportsTo");

    if (!project) return res.status(404).json({ message: "Project not found" });

    const memberIds = (project.members || []).map((m) => m._id);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    weekAgo.setHours(0, 0, 0, 0);

    const [tasks, issues, files, logs] = await Promise.all([
      Task.find({ project: project._id })
        .populate("assignedTo", "name designation")
        .sort({ dueDate: 1, createdAt: -1 }),
      Issue.find({ project: project._id })
        .populate("assignedTo", "name")
        .populate("raisedBy", "name")
        .sort({ createdAt: -1 }),
      FileDoc.find({ project: project._id })
        .select("title category fileType createdAt")
        .sort({ createdAt: -1 })
        .limit(8),
      // What the team has actually been filing this past week
      WorkLog.find({ employee: { $in: memberIds }, date: { $gte: weekAgo } })
        .populate("employee", "name designation")
        .populate("tasks", "title status")
        .sort({ date: -1 })
        .limit(20),
    ]);

    const byStatus = tasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {});

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    return res.status(200).json({
      project,
      tasks,
      issues,
      files,
      logs,
      stats: {
        tasksTotal: tasks.length,
        pending: byStatus.pending || 0,
        inProgress: byStatus.in_progress || 0,
        // The number that matters on this screen — work awaiting a sign-off
        inReview: byStatus.review || 0,
        completed: byStatus.completed || 0,
        overdue: tasks.filter(
          (task) =>
            task.status !== "completed" && task.dueDate && new Date(task.dueDate) < startOfToday
        ).length,
        openIssues: issues.filter((issue) => ["open", "in_progress"].includes(issue.status)).length,
        members: memberIds.length,
        hoursThisWeek: Number(
          logs.reduce((sum, log) => sum + (log.hours || 0), 0).toFixed(1)
        ),
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
