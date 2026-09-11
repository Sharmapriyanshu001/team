import Task from "../../models/Task.js";
import Issue from "../../models/Issue.js";
import FileDoc from "../../models/FileDoc.js";
import Project from "../../models/Project.js";
import User, { ADMIN_ROLES } from "../../models/User.js";
import Notification from "../../models/Notification.js";
import { getScope } from "../../middleware/leaderAuth.js";
import { logActivity } from "../../utils/activity.js";
import { notifyUser } from "../../utils/notify.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ownsProject = (projectIds, id) => projectIds.some((p) => String(p) === String(id));

/* ----------------------------------------------------------------- files */

/**
 * GET /api/leader/files
 *
 * Files on the projects they lead, plus anything the admin assigned to them
 * personally. `?view=assigned` narrows it to just their own hand-overs.
 */
export const listFiles = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);
    const assignedToMe = { assignedTo: req.leader._id };

    const query =
      req.query.view === "assigned"
        ? { ...assignedToMe }
        : { $or: [{ project: { $in: projectIds } }, assignedToMe] };

    if (req.query.status && req.query.status !== "all") query.status = req.query.status;
    if (req.query.category && req.query.category !== "all") query.category = req.query.category;
    if (req.query.project && req.query.project !== "all") {
      if (!ownsProject(projectIds, req.query.project)) {
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
    console.error("leader listFiles error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/leader/files
export const createFile = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);
    if (!ownsProject(projectIds, req.body.project)) {
      return res.status(400).json({ message: "Pick one of your own projects" });
    }

    const created = await FileDoc.create({
      ...req.body,
      uploadedBy: req.leader._id,
      client: undefined, // files a leader adds belong to the project, not a client
    });

    const item = await FileDoc.findById(created._id).populate("project", "name code");

    logActivity(req, {
      action: "created",
      entity: "File",
      entityId: created._id,
      message: `${req.leader.name} uploaded "${created.title}"`,
    });

    return res.status(201).json({ message: "File added", item });
  } catch (err) {
    console.error("leader createFile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// DELETE /api/leader/files/:id — only files the leader added themselves
export const removeFile = async (req, res) => {
  try {
    const existing = await FileDoc.findOne({
      _id: req.params.id,
      uploadedBy: req.leader._id,
    });

    if (!existing) {
      return res.status(404).json({ message: "File not found, or it was not uploaded by you" });
    }

    await existing.deleteOne();

    logActivity(req, {
      action: "deleted",
      entity: "File",
      entityId: existing._id,
      message: `${req.leader.name} removed "${existing.title}"`,
    });

    return res.status(200).json({ message: "File removed" });
  } catch (err) {
    console.error("leader removeFile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------------- issues */

// GET /api/leader/issues
export const listIssues = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);
    const query = { project: { $in: projectIds } };

    if (req.query.status && req.query.status !== "all") query.status = req.query.status;
    if (req.query.severity && req.query.severity !== "all") query.severity = req.query.severity;
    if (req.query.project && req.query.project !== "all") {
      if (!ownsProject(projectIds, req.query.project)) {
        return res.status(403).json({ message: "That project is not one of yours" });
      }
      query.project = req.query.project;
    }

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
        .populate("assignedTo", "name")
        .populate("raisedBy", "name")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Issue.countDocuments(query),
    ]);

    return res.status(200).json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error("leader listIssues error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/leader/issues
export const createIssue = async (req, res) => {
  try {
    const { projectIds, teamIds } = await getScope(req);

    if (!ownsProject(projectIds, req.body.project)) {
      return res.status(400).json({ message: "Pick one of your own projects" });
    }
    if (req.body.assignedTo && !teamIds.some((id) => String(id) === String(req.body.assignedTo))) {
      return res.status(400).json({ message: "You can only assign issues to your own team" });
    }

    const payload = { ...req.body, raisedBy: req.leader._id };
    if (!payload.assignedTo) delete payload.assignedTo;

    const created = await Issue.create(payload);
    const item = await Issue.findById(created._id)
      .populate("project", "name code")
      .populate("assignedTo", "name")
      .populate("raisedBy", "name");

    logActivity(req, {
      action: "created",
      entity: "Issue",
      entityId: created._id,
      message: `${req.leader.name} reported "${created.title}"`,
    });

    // Keep the admin in the loop on anything serious
    if (["high", "critical"].includes(created.severity)) {
      const admins = await User.find({ role: { $in: ADMIN_ROLES } }).select("_id");
      admins.forEach((admin) =>
        notifyUser(admin._id, {
          type: "issue",
          title: `${created.severity === "critical" ? "Critical" : "High"} issue reported`,
          message: `${req.leader.name}: ${created.title}`,
          link: "/admin/issues",
        })
      );
    }

    return res.status(201).json({ message: "Issue reported", item });
  } catch (err) {
    console.error("leader createIssue error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/leader/issues/:id
export const updateIssue = async (req, res) => {
  try {
    const { projectIds, teamIds } = await getScope(req);

    const existing = await Issue.findOne({ _id: req.params.id, project: { $in: projectIds } });
    if (!existing) return res.status(404).json({ message: "Issue not found" });

    const payload = { ...req.body };
    delete payload._id;
    delete payload.raisedBy;
    delete payload.project;

    if (payload.assignedTo && !teamIds.some((id) => String(id) === String(payload.assignedTo))) {
      return res.status(400).json({ message: "You can only assign issues to your own team" });
    }
    if (payload.assignedTo === "") payload.assignedTo = null;

    // resolvedAt is the model's job now — see models/Issue.js

    Object.assign(existing, payload);
    await existing.save();

    const item = await Issue.findById(existing._id)
      .populate("project", "name code")
      .populate("assignedTo", "name")
      .populate("raisedBy", "name");

    logActivity(req, {
      action: "updated",
      entity: "Issue",
      entityId: existing._id,
      message: `${req.leader.name} updated "${existing.title}"`,
    });

    return res.status(200).json({ message: "Issue updated", item });
  } catch (err) {
    console.error("leader updateIssue error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- calendar */

// GET /api/leader/calendar?month=YYYY-MM
// Task deadlines plus project start/end dates for the month, as flat events.
export const getCalendar = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);

    const [year, month] = (req.query.month || "").split("-").map(Number);
    const base = year && month ? new Date(year, month - 1, 1) : new Date();
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);

    const [tasks, projects] = await Promise.all([
      Task.find({ project: { $in: projectIds }, dueDate: { $gte: start, $lt: end } })
        .populate("assignedTo", "name")
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

    const events = [];

    tasks.forEach((task) =>
      events.push({
        id: `task-${task._id}`,
        kind: "task",
        date: task.dueDate,
        title: task.title,
        subtitle: task.assignedTo?.name || "Unassigned",
        context: task.project?.name || "",
        status: task.status,
        priority: task.priority,
      })
    );

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
    console.error("leader getCalendar error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------- notifications */

// GET /api/leader/notifications
export const listNotifications = async (req, res) => {
  try {
    const query = { user: req.leader._id };
    if (req.query.filter === "unread") query.read = false;
    if (req.query.type && req.query.type !== "all") query.type = req.query.type;

    const [items, unread] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).limit(100),
      Notification.countDocuments({ user: req.leader._id, read: false }),
    ]);

    return res.status(200).json({ items, unread });
  } catch (err) {
    console.error("leader listNotifications error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/leader/notifications/:id/read
export const markNotificationRead = async (req, res) => {
  try {
    const updated = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.leader._id },
      { $set: { read: true } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: "Notification not found" });
    return res.status(200).json({ message: "Marked as read", item: updated });
  } catch (err) {
    console.error("leader markNotificationRead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/leader/notifications/read-all
export const markAllRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { user: req.leader._id, read: false },
      { $set: { read: true } }
    );
    return res.status(200).json({ message: "All caught up", updated: result.modifiedCount });
  } catch (err) {
    console.error("leader markAllRead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- reports */

// GET /api/leader/reports?from=&to=
export const getReports = async (req, res) => {
  try {
    const { projectIds, teamIds } = await getScope(req);

    const to = req.query.to ? new Date(req.query.to) : new Date();
    to.setHours(23, 59, 59, 999);
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(to.getFullYear(), to.getMonth() - 2, 1);
    from.setHours(0, 0, 0, 0);

    const range = { $gte: from, $lte: to };

    const [projects, tasks, issues, workloadRows, completedRows, members] = await Promise.all([
      Project.find({ _id: { $in: projectIds } })
        .populate("client", "name company")
        .sort({ endDate: 1 }),
      Task.aggregate([
        { $match: { project: { $in: projectIds }, createdAt: range } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Issue.aggregate([
        { $match: { project: { $in: projectIds }, createdAt: range } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Task.aggregate([
        { $match: { assignedTo: { $in: teamIds }, createdAt: range } },
        {
          $group: {
            _id: "$assignedTo",
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          },
        },
        { $sort: { total: -1 } },
      ]),
      Task.aggregate([
        { $match: { project: { $in: projectIds }, status: "completed", completedAt: range } },
        { $group: { _id: "$project", count: { $sum: 1 } } },
      ]),
      User.find({ _id: { $in: teamIds } }).select("name designation"),
    ]);

    const memberById = members.reduce((acc, m) => ({ ...acc, [String(m._id)]: m }), {});
    const completedByProject = completedRows.reduce(
      (acc, row) => ({ ...acc, [String(row._id)]: row.count }),
      {}
    );

    const taskTotal = tasks.reduce((sum, t) => sum + t.count, 0);
    const taskDone = tasks.find((t) => t._id === "completed")?.count || 0;

    return res.status(200).json({
      range: { from, to },
      summary: {
        projects: projects.length,
        completedProjects: projects.filter((p) => p.status === "completed").length,
        tasks: taskTotal,
        tasksCompleted: taskDone,
        completionRate: taskTotal ? Math.round((taskDone / taskTotal) * 100) : 0,
        issues: issues.reduce((sum, i) => sum + i.count, 0),
        teamSize: members.length,
      },
      tasksByStatus: tasks.map((t) => ({ name: t._id, value: t.count })),
      issuesByStatus: issues.map((i) => ({ name: i._id, value: i.count })),
      workload: workloadRows.map((row) => ({
        id: row._id,
        name: memberById[String(row._id)]?.name || "Unknown",
        designation: memberById[String(row._id)]?.designation || "",
        total: row.total,
        completed: row.completed,
        pending: row.total - row.completed,
      })),
      projects: projects.map((p) => ({
        id: p._id,
        name: p.name,
        code: p.code,
        client: p.client?.company || p.client?.name || "—",
        status: p.status,
        progress: p.progress,
        endDate: p.endDate,
        tasksCompletedInRange: completedByProject[String(p._id)] || 0,
      })),
    });
  } catch (err) {
    console.error("leader getReports error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- lookups */

// GET /api/leader/lookups — dropdown options limited to the leader's scope
export const getLookups = async (req, res) => {
  try {
    const { projectIds, teamIds, managedTeams } = await getScope(req);

    const [projects, assignable] = await Promise.all([
      Project.find({ _id: { $in: projectIds } }).select("name code").sort({ name: 1 }),

      /**
       * Who this account may hand work to — which is wider than who reports to
       * them, and used to be narrower.
       *
       * This list only ever held `teamIds`: direct reports plus the members of
       * any department this account runs. An operations manager with neither —
       * the ordinary case for somebody the admin has just given a project to —
       * got an "Assign to" dropdown containing nothing but "Leave unassigned",
       * so the one screen for handing work down could not hand work to anybody.
       *
       * The server was never that strict. validateRefs in the task controller
       * accepts any active employee, and only falls back to the reporting line
       * for people who are not employees — somebody on a department this
       * account manages. Assign Work has always offered the wider list too.
       * So the dropdown was refusing choices the API behind it would have
       * taken, which is the worst of the three to disagree with.
       *
       * Mirrored here deliberately, in the same two branches and the same
       * order, so the list offered is the list accepted. Administrators are
       * left out because the chain runs downwards; inactive accounts because
       * they cannot be given work at all.
       */
      User.find({
        status: "active",
        role: { $nin: ADMIN_ROLES },
        $or: [{ role: "employee" }, { _id: { $in: teamIds } }],
      })
        .select("name designation role")
        .sort({ name: 1 }),
    ]);

    /**
     * Their own people first, then everybody else, each alphabetically — the
     * order Assign Work already uses. The common case stays at the top of the
     * list without the rest being hidden behind a decision.
     */
    const mine = new Set(teamIds.map(String));
    const team = assignable
      .map((person) => ({ ...person.toObject(), reportsToMe: mine.has(String(person._id)) }))
      .sort((a, b) =>
        a.reportsToMe === b.reportsToMe
          ? a.name.localeCompare(b.name)
          : a.reportsToMe
            ? -1
            : 1
      );

    /**
     * The departments this account runs, for work that belongs to the team
     * rather than to a client project. Empty for an operations manager who manages
     * none, which is what makes the option disappear for them.
     */
    return res.status(200).json({ projects, team, departments: managedTeams });
  } catch (err) {
    console.error("leader getLookups error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
