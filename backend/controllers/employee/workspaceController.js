import Project from "../../models/Project.js";
import Task from "../../models/Task.js";
import Issue from "../../models/Issue.js";
import FileDoc from "../../models/FileDoc.js";
import Notification from "../../models/Notification.js";
import { getScope } from "../../middleware/employeeAuth.js";
import { logActivity } from "../../utils/activity.js";
import { notifyUser } from "../../utils/notify.js";
import { assignedByFor } from "../../utils/projectTeam.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const onMyProject = (projectIds, id) => projectIds.some((p) => String(p) === String(id));

/* -------------------------------------------------------------- projects */

// GET /api/employee/projects?view=active|completed
export const listProjects = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);
    const query = { _id: { $in: projectIds } };

    if (req.query.view === "active") {
      query.status = { $in: ["planning", "in_progress", "on_hold"] };
    } else if (req.query.view === "completed") {
      query.status = { $in: ["completed", "cancelled"] };
    }

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [{ name: regex }, { code: regex }];
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 25);

    const [projects, total] = await Promise.all([
      Project.find(query)
        .populate("client", "name company")
        .populate("operationsManager", "name designation")
        .sort({ endDate: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Project.countDocuments(query),
    ]);

    // How much of each project is on this employee's plate
    const myTaskRows = await Task.aggregate([
      {
        $match: {
          assignedTo: req.employee._id,
          project: { $in: projects.map((p) => p._id) },
        },
      },
      {
        $group: {
          _id: "$project",
          myTasks: { $sum: 1 },
          myCompleted: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        },
      },
    ]);

    const byProject = myTaskRows.reduce((acc, row) => ({ ...acc, [String(row._id)]: row }), {});

    const items = projects.map((project) => {
      const mine = byProject[String(project._id)] || { myTasks: 0, myCompleted: 0 };

      /**
       * Who put this employee on the project, and when. Falls back to the
       * project's operations manager for memberships made before this was recorded —
       * they are answerable for it either way — but the date is never guessed.
       */
      const from = assignedByFor(
        project.memberAssignments,
        req.employee._id,
        project.operationsManager?.name
      );

      const row = project.toObject();
      // The other members' records are nobody else's business
      delete row.memberAssignments;

      return {
        ...row,
        myTasks: mine.myTasks,
        myCompleted: mine.myCompleted,
        assignedBy: from.assignedBy,
        assignedAt: from.assignedAt,
        assignedExact: from.exact,
      };
    });

    return res.status(200).json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error("employee listProjects error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/employee/projects/:id
 *
 * Everything about one project this employee is on: who owns it, what the
 * whole board looks like beside their own slice of it, the files and archives
 * handed over against it, and what is still open.
 *
 * Membership is the whole permission. The id is checked against the same
 * scope the list uses, so a project this employee is not on reads as missing
 * rather than as refused — there is nothing to learn from the difference.
 */
export const getProjectDetails = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);

    if (!onMyProject(projectIds, req.params.id)) {
      return res.status(404).json({ message: "Project not found" });
    }

    const project = await Project.findById(req.params.id)
      /**
       * Name and company only. An employee on the project needs to know whose
       * work this is; the client's phone number and address are the sales and
       * admin side's to hold, and nothing on this screen asks for them.
       */
      .populate("client", "name company")
      .populate("operationsManager", "name email designation")
      .populate("members", "name designation department");

    if (!project) return res.status(404).json({ message: "Project not found" });

    const [tasks, issues, files] = await Promise.all([
      Task.find({ project: project._id })
        .populate("assignedTo", "name designation")
        .populate("assignedBy", "name")
        .sort({ dueDate: 1, createdAt: -1 }),

      Issue.find({ project: project._id })
        .populate("assignedTo", "name")
        .populate("raisedBy", "name")
        .sort({ createdAt: -1 })
        .limit(20),

      /**
       * Every file on the project, not only this employee's own.
       *
       * That is already what the download route allows — anyone on a project
       * may pull a file sitting on it — so listing less here would hide
       * documents an employee can reach anyway and is expected to work from.
       * Which ones are theirs to act on is marked per row instead.
       */
      FileDoc.find({ project: project._id })
        .populate("assignedTo", "name")
        .populate("assignedBy", "name")
        .populate("uploadedBy", "name")
        .populate("task", "title")
        .sort({ createdAt: -1 }),
    ]);

    const mine = (id) => String(id) === String(req.employee._id);

    const myTasks = tasks.filter((task) => mine(task.assignedTo?._id));
    const completed = tasks.filter((task) => task.status === "completed").length;

    const taskStats = tasks.reduce(
      (acc, task) => ({ ...acc, [task.status]: (acc[task.status] || 0) + 1 }),
      {}
    );

    const from = assignedByFor(
      project.memberAssignments,
      req.employee._id,
      project.operationsManager?.name
    );

    const record = project.toObject();
    // How everyone else came to be on the project is nobody else's business
    delete record.memberAssignments;

    return res.status(200).json({
      project: record,
      assignedBy: from.assignedBy,
      assignedAt: from.assignedAt,
      assignedExact: from.exact,

      myTasks,
      teamTasks: tasks.filter((task) => !mine(task.assignedTo?._id)),
      taskStats,

      /**
       * One percentage, and the task counts beside it as a plain fact.
       *
       * `Project.progress` is not a number somebody typed any more —
       * utils/projectProgress.js recomputes it from the tasks on every task
       * save, as the average of each task's own progress. Sending a second,
       * count-of-completed percentage alongside it would be offering the
       * employee a rival figure that the app deliberately does not use:
       * counting completed tasks sits at 0% for as long as the first task
       * takes, which is exactly why the roll-up averages instead.
       */
      progress: {
        percent: project.progress ?? 0,
        completed,
        total: tasks.length,
      },

      files: files.map((file) => ({
        ...file.toObject(),
        // Whether this one is theirs to download and sign off, or reference
        isMine: mine(file.assignedTo?._id),
      })),

      issues,
    });
  } catch (err) {
    console.error("employee getProjectDetails error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ----------------------------------------------------------------- files */

/**
 * GET /api/employee/files
 *
 * Everything on their projects, plus anything the admin handed to them
 * personally — an assigned file may sit on a project they are not a member of.
 * `?view=assigned` narrows it to just their own hand-overs.
 */
export const listFiles = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);
    const assignedToMe = { assignedTo: req.employee._id };

    const query =
      req.query.view === "assigned"
        ? { ...assignedToMe }
        : { $or: [{ project: { $in: projectIds } }, assignedToMe] };

    if (req.query.status && req.query.status !== "all") query.status = req.query.status;
    if (req.query.category && req.query.category !== "all") query.category = req.query.category;
    if (req.query.project && req.query.project !== "all") {
      if (!onMyProject(projectIds, req.query.project)) {
        return res.status(403).json({ message: "That project is not one of yours" });
      }
      query.project = req.query.project;
    }

    const search = (req.query.search || "").trim();
    if (search) query.title = new RegExp(escapeRegex(search), "i");

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 25);

    const [items, total] = await Promise.all([
      FileDoc.find(query)
        .populate("project", "name code")
        .populate("uploadedBy", "name")
        .populate("assignedTo", "name role")
        .populate("assignedBy", "name")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      FileDoc.countDocuments(query),
    ]);

    return res.status(200).json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error("employee listFiles error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------------- issues */

// GET /api/employee/issues
export const listIssues = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);
    const query = { project: { $in: projectIds } };

    if (req.query.status && req.query.status !== "all") query.status = req.query.status;
    if (req.query.severity && req.query.severity !== "all") query.severity = req.query.severity;
    if (req.query.view === "mine") query.raisedBy = req.employee._id;
    if (req.query.view === "assigned") query.assignedTo = req.employee._id;

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [{ title: regex }, { description: regex }];
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 25);

    const [items, total] = await Promise.all([
      Issue.find(query)
        .populate("project", "name code")
        .populate("raisedBy", "name")
        .populate("assignedTo", "name")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Issue.countDocuments(query),
    ]);

    return res.status(200).json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error("employee listIssues error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/employee/issues
export const createIssue = async (req, res) => {
  try {
    const { projectIds, leaderId } = await getScope(req);

    if (!onMyProject(projectIds, req.body.project)) {
      return res.status(400).json({ message: "Pick one of your own projects" });
    }

    const created = await Issue.create({
      title: req.body.title,
      description: req.body.description,
      project: req.body.project,
      severity: req.body.severity || "medium",
      status: "open",
      raisedBy: req.employee._id,
      // Issues an employee raises land with their operations manager
      assignedTo: leaderId || undefined,
    });

    const item = await Issue.findById(created._id)
      .populate("project", "name code")
      .populate("raisedBy", "name")
      .populate("assignedTo", "name");

    logActivity(req, {
      action: "created",
      entity: "Issue",
      entityId: created._id,
      message: `${req.employee.name} reported "${created.title}"`,
    });

    if (leaderId) {
      notifyUser(leaderId, {
        type: "issue",
        title: `New ${created.severity} issue from ${req.employee.name}`,
        message: created.title,
        link: "/operation-manager/issues",
      });
    }

    return res.status(201).json({ message: "Issue reported", item });
  } catch (err) {
    console.error("employee createIssue error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/employee/issues/:id — only issues they raised or own
export const updateIssue = async (req, res) => {
  try {
    const existing = await Issue.findOne({
      _id: req.params.id,
      $or: [{ raisedBy: req.employee._id }, { assignedTo: req.employee._id }],
    });

    if (!existing) {
      return res
        .status(404)
        .json({ message: "Issue not found, or it was not raised by or assigned to you" });
    }

    const { description, severity, status } = req.body;

    if (description !== undefined) existing.description = description;
    if (severity !== undefined) existing.severity = severity;
    if (status !== undefined) {
      // Closing an issue for good stays with the leader
      if (!["open", "in_progress", "resolved"].includes(status)) {
        return res.status(400).json({ message: "Only your operations manager can close an issue" });
      }
      existing.status = status;
      if (status === "resolved") existing.resolvedAt = new Date();
    }

    await existing.save();

    const item = await Issue.findById(existing._id)
      .populate("project", "name code")
      .populate("raisedBy", "name")
      .populate("assignedTo", "name");

    return res.status(200).json({ message: "Issue updated", item });
  } catch (err) {
    console.error("employee updateIssue error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- calendar */

// GET /api/employee/calendar?month=YYYY-MM
export const getCalendar = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);

    const [year, month] = (req.query.month || "").split("-").map(Number);
    const base = year && month ? new Date(year, month - 1, 1) : new Date();
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);

    const [tasks, projects] = await Promise.all([
      Task.find({ assignedTo: req.employee._id, dueDate: { $gte: start, $lt: end } })
        .populate("project", "name code")
        .sort({ dueDate: 1 }),
      Project.find({
        _id: { $in: projectIds },
        $or: [
          { startDate: { $gte: start, $lt: end } },
          { endDate: { $gte: start, $lt: end } },
        ],
      }).select("name code status startDate endDate"),
    ]);

    const events = tasks.map((task) => ({
      id: `task-${task._id}`,
      kind: "task",
      date: task.dueDate,
      title: task.title,
      subtitle: task.project?.name || "No project",
      status: task.status,
      priority: task.priority,
      taskId: task._id,
    }));

    projects.forEach((project) => {
      if (project.startDate >= start && project.startDate < end) {
        events.push({
          id: `start-${project._id}`,
          kind: "project_start",
          date: project.startDate,
          title: `${project.name} starts`,
          subtitle: project.code || "",
          status: project.status,
        });
      }
      if (project.endDate >= start && project.endDate < end) {
        events.push({
          id: `end-${project._id}`,
          kind: "project_end",
          date: project.endDate,
          title: `${project.name} deadline`,
          subtitle: project.code || "",
          status: project.status,
        });
      }
    });

    events.sort((a, b) => new Date(a.date) - new Date(b.date));

    return res.status(200).json({
      month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      events,
    });
  } catch (err) {
    console.error("employee getCalendar error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------- notifications */

export const listNotifications = async (req, res) => {
  try {
    const query = { user: req.employee._id };
    if (req.query.filter === "unread") query.read = false;
    if (req.query.type && req.query.type !== "all") query.type = req.query.type;

    const [items, unread] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).limit(100),
      Notification.countDocuments({ user: req.employee._id, read: false }),
    ]);

    return res.status(200).json({ items, unread });
  } catch (err) {
    console.error("employee listNotifications error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const updated = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.employee._id },
      { $set: { read: true } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: "Notification not found" });
    return res.status(200).json({ message: "Marked as read", item: updated });
  } catch (err) {
    console.error("employee markNotificationRead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const markAllRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { user: req.employee._id, read: false },
      { $set: { read: true } }
    );
    return res.status(200).json({ message: "All caught up", updated: result.modifiedCount });
  } catch (err) {
    console.error("employee markAllRead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- lookups */

// GET /api/employee/lookups
export const getLookups = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);

    /**
     * Tasks ride along with the projects because the code submission form
     * needs them: a submission may name the task it was done for, and
     * approving it is what closes that task.
     *
     * Completed ones are left out — there is nothing left to submit against
     * work the operations manager has already signed off.
     */
    const [projects, tasks] = await Promise.all([
      Project.find({ _id: { $in: projectIds } })
        .select("name code")
        .sort({ name: 1 }),
      Task.find({
        assignedTo: req.employee._id,
        status: { $ne: "completed" },
      })
        .select("title project status priority dueDate")
        .sort({ dueDate: 1, createdAt: -1 })
        .limit(100),
    ]);

    return res.status(200).json({ projects, tasks });
  } catch (err) {
    console.error("employee getLookups error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
