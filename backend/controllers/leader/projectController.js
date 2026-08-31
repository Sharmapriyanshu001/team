import Project from "../../models/Project.js";
import Task from "../../models/Task.js";
import Issue from "../../models/Issue.js";
import FileDoc from "../../models/FileDoc.js";
import { getScope } from "../../middleware/leaderAuth.js";
import { logActivity } from "../../utils/activity.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/leader/projects?view=active|completed&search=&page=
export const listProjects = async (req, res) => {
  try {
    const query = { teamLeader: req.leader._id };

    if (req.query.view === "active") {
      query.status = { $in: ["planning", "in_progress", "on_hold"] };
    } else if (req.query.view === "completed") {
      query.status = { $in: ["completed", "cancelled"] };
    } else if (req.query.status && req.query.status !== "all") {
      query.status = req.query.status;
    }

    if (req.query.priority && req.query.priority !== "all") {
      query.priority = req.query.priority;
    }

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [{ name: regex }, { code: regex }, { description: regex }];
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 25);

    const [items, total] = await Promise.all([
      Project.find(query)
        .populate("client", "name company email phone")
        .populate("members", "name designation")
        .sort({ endDate: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Project.countDocuments(query),
    ]);

    return res.status(200).json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error("leader listProjects error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/leader/projects/:id  -> everything the "Project Details" screen shows
export const getProject = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      teamLeader: req.leader._id,
    })
      .populate("client", "name company email phone address")
      .populate("members", "name email designation department")
      .populate("teamLeader", "name email");

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const [tasks, issues, files, taskStats] = await Promise.all([
      Task.find({ project: project._id })
        .populate("assignedTo", "name designation")
        .sort({ dueDate: 1, createdAt: -1 }),
      Issue.find({ project: project._id })
        .populate("assignedTo", "name")
        .populate("raisedBy", "name")
        .sort({ createdAt: -1 }),
      FileDoc.find({ project: project._id }).sort({ createdAt: -1 }),
      Task.aggregate([
        { $match: { project: project._id } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const byStatus = taskStats.reduce((acc, row) => {
      acc[row._id] = row.count;
      return acc;
    }, {});

    return res.status(200).json({
      project,
      tasks,
      issues,
      files,
      taskStats: byStatus,
    });
  } catch (err) {
    console.error("leader getProject error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/leader/projects/:id/progress  { progress, status }
// A leader can move their own project along but cannot change budget, client
// or team assignment — those stay with the admin.
export const updateProgress = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      teamLeader: req.leader._id,
    });

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const { progress, status } = req.body;

    if (progress !== undefined) {
      const value = Number(progress);
      if (Number.isNaN(value) || value < 0 || value > 100) {
        return res.status(400).json({ message: "Progress must be between 0 and 100" });
      }
      project.progress = Math.round(value);
    }

    if (status) {
      const allowed = ["planning", "in_progress", "on_hold", "completed"];
      if (!allowed.includes(status)) {
        return res.status(400).json({ message: "That status is not allowed" });
      }
      project.status = status;
      if (status === "completed") project.progress = 100;
    }

    await project.save();

    logActivity(req, {
        action: "updated",
        entity: "Project",
        entityId: project._id,
        message: `${req.leader.name} set "${project.name}" to ${project.progress}% (${project.status})`,
    });

    // Return it populated so the details screen can merge it in as-is.
    const item = await Project.findById(project._id)
      .populate("client", "name company email phone address")
      .populate("members", "name email designation department")
      .populate("teamLeader", "name email");

    return res.status(200).json({ message: "Project updated", item });
  } catch (err) {
    console.error("leader updateProgress error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/leader/progress  -> compact list for the "Project Progress" screen
export const getProgressBoard = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);

    const [projects, taskRows] = await Promise.all([
      Project.find({ _id: { $in: projectIds } })
        .populate("client", "name company")
        .sort({ endDate: 1 }),
      Task.aggregate([
        { $match: { project: { $in: projectIds } } },
        {
          $group: {
            _id: "$project",
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const tasksByProject = taskRows.reduce((acc, row) => {
      acc[String(row._id)] = row;
      return acc;
    }, {});

    const today = new Date();

    const items = projects.map((project) => {
      const stats = tasksByProject[String(project._id)] || { total: 0, completed: 0 };
      const end = project.endDate ? new Date(project.endDate) : null;
      const daysLeft = end ? Math.ceil((end - today) / 86400000) : null;

      return {
        id: project._id,
        name: project.name,
        code: project.code,
        client: project.client?.company || project.client?.name || "—",
        status: project.status,
        priority: project.priority,
        progress: project.progress,
        startDate: project.startDate,
        endDate: project.endDate,
        daysLeft,
        overdue: daysLeft !== null && daysLeft < 0 && project.status !== "completed",
        tasks: stats.total,
        tasksCompleted: stats.completed,
        taskProgress: stats.total ? Math.round((stats.completed / stats.total) * 100) : 0,
      };
    });

    return res.status(200).json({ items });
  } catch (err) {
    console.error("leader getProgressBoard error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
