import Project from "../../models/Project.js";
import Task from "../../models/Task.js";
import Issue from "../../models/Issue.js";
import FileDoc from "../../models/FileDoc.js";
import Meeting from "../../models/Meeting.js";
import Feedback from "../../models/Feedback.js";
import Notification from "../../models/Notification.js";
import User, { ADMIN_ROLES } from "../../models/User.js";
import ChangeRequest from "../../models/ChangeRequest.js";
import { getScope } from "../../middleware/clientAuth.js";
import { estimateCompletion } from "../../utils/projectEstimate.js";
import { newMeetLink } from "../../utils/meetLink.js";
import { logActivity } from "../../utils/activity.js";
import { notifyUsers } from "../../utils/notify.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const onMyProject = (projectIds, id) => projectIds.some((p) => String(p) === String(id));

const adminIds = async () => User.find({ role: { $in: ADMIN_ROLES } }).distinct("_id");

/* -------------------------------------------------------------- projects */

// GET /api/client/projects?view=active|completed
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
        .populate("operationsManager", "name email designation phone")
        .sort({ endDate: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Project.countDocuments(query),
    ]);

    // Task counts give the client a sense of movement without exposing detail
    const taskRows = await Task.aggregate([
      { $match: { project: { $in: projects.map((p) => p._id) } } },
      {
        $group: {
          _id: "$project",
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        },
      },
    ]);

    const byProject = taskRows.reduce((acc, row) => ({ ...acc, [String(row._id)]: row }), {});

    const items = projects.map((project) => {
      const stats = byProject[String(project._id)] || { total: 0, completed: 0 };

      /**
       * Everything except the money.
       *
       * `budget` used to ride out on the spread, which put the value of the
       * contract on the client's own screen — where it is at best redundant
       * and at worst the wrong figure, since what a project is worth to the
       * company and what this client was invoiced are not the same number.
       * Money is the administrator's, and lives behind the payments route.
       */
      const { budget, ...safe } = project.toObject();

      return {
        ...safe,
        tasks: stats.total,
        tasksCompleted: stats.completed,
      };
    });

    return res.status(200).json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error("client listProjects error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/client/progress  -> the "Project Progress" screen
export const getProgress = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);

    const [projects, taskRows, issueRows, changeRows] = await Promise.all([
      Project.find({ _id: { $in: projectIds } })
        .populate("operationsManager", "name designation")
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
      Issue.aggregate([
        {
          $match: {
            project: { $in: projectIds },
            status: { $in: ["open", "in_progress"] },
          },
        },
        { $group: { _id: "$project", count: { $sum: 1 } } },
      ]),
      /** Changes this client asked for that nobody has closed yet. */
      ChangeRequest.aggregate([
        {
          $match: {
            project: { $in: projectIds },
            status: { $in: ["open", "in_progress"] },
          },
        },
        { $group: { _id: "$project", count: { $sum: 1 } } },
      ]),
    ]);

    const tasksByProject = taskRows.reduce((acc, r) => ({ ...acc, [String(r._id)]: r }), {});
    const issuesByProject = issueRows.reduce((acc, r) => ({ ...acc, [String(r._id)]: r.count }), {});
    const changesByProject = changeRows.reduce(
      (acc, r) => ({ ...acc, [String(r._id)]: r.count }),
      {}
    );

    const today = new Date();

    const items = projects.map((project) => {
      const stats = tasksByProject[String(project._id)] || { total: 0, completed: 0 };
      const end = project.endDate ? new Date(project.endDate) : null;
      const daysLeft = end ? Math.ceil((end - today) / 86400000) : null;

      /**
       * When it will actually be done, worked out from the tasks rather than
       * from the date somebody wrote down at the start. Comes back null with a
       * reason when there is not enough finished work to project from — see
       * utils/projectEstimate.js for why a blank beats a confident guess.
       */
      const estimate = estimateCompletion(project, stats, today);

      /** No budget. Money is the administrator's — see listProjects above. */
      return {
        id: project._id,
        name: project.name,
        code: project.code,
        description: project.description,
        status: project.status,
        priority: project.priority,
        progress: project.progress,
        startDate: project.startDate,
        endDate: project.endDate,
        daysLeft,
        overdue: daysLeft !== null && daysLeft < 0 && project.status !== "completed",
        operationsManager: project.operationsManager,
        teamSize: project.members?.length || 0,
        tasks: stats.total,
        tasksCompleted: stats.completed,
        tasksRemaining: estimate.tasksRemaining,
        taskProgress: estimate.taskProgress,
        estimatedDate: estimate.estimatedDate,
        daysNeeded: estimate.daysNeeded,
        estimateBasis: estimate.basis,
        behindPlan: estimate.behindPlan,
        openIssues: issuesByProject[String(project._id)] || 0,
        openRequests: changesByProject[String(project._id)] || 0,
      };
    });

    return res.status(200).json({ items });
  } catch (err) {
    console.error("client getProgress error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ----------------------------------------------------------------- files */

// GET /api/client/files — documents filed against the client or their projects
export const listFiles = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);
    const query = {
      $or: [{ client: req.client._id }, { project: { $in: projectIds } }],
      // Work handed to a team member is internal — the client portal shows
      // documents, not the team's assignments.
      assignedTo: null,
    };

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
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      FileDoc.countDocuments(query),
    ]);

    return res.status(200).json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error("client listFiles error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- feedback */

// GET /api/client/feedback
export const listFeedback = async (req, res) => {
  try {
    const query = { client: req.client._id };
    if (req.query.status && req.query.status !== "all") query.status = req.query.status;
    if (req.query.category && req.query.category !== "all") query.category = req.query.category;

    const [items, stats] = await Promise.all([
      Feedback.find(query)
        .populate("project", "name code")
        .populate("respondedBy", "name designation")
        .sort({ createdAt: -1 }),
      Feedback.aggregate([
        { $match: { client: req.client._id } },
        { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
      ]),
    ]);

    return res.status(200).json({
      items,
      total: items.length,
      page: 1,
      pages: 1,
      summary: {
        avgRating: Number((stats[0]?.avg || 0).toFixed(1)),
        count: stats[0]?.count || 0,
        awaitingReply: items.filter((f) => !f.response).length,
      },
    });
  } catch (err) {
    console.error("client listFeedback error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/client/feedback
export const createFeedback = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);
    const { project, category, rating, message } = req.body;

    const value = Number(rating);
    if (!value || value < 1 || value > 5) {
      return res.status(400).json({ message: "Give a rating between 1 and 5" });
    }
    if (project && !onMyProject(projectIds, project)) {
      return res.status(400).json({ message: "That project is not one of yours" });
    }

    const created = await Feedback.create({
      client: req.client._id,
      project: project || undefined,
      category: category || "overall",
      rating: value,
      message: (message || "").trim(),
    });

    const item = await Feedback.findById(created._id).populate("project", "name code");

    logActivity(req, {
      action: "created",
      entity: "Feedback",
      entityId: created._id,
      message: `${req.client.name} left ${value}-star feedback`,
    });

    // Low scores should reach the admin immediately
    notifyUsers(await adminIds(), {
      type: "system",
      title:
        value <= 2
          ? `Low rating from ${req.client.name}`
          : `New feedback from ${req.client.name}`,
      message: `${value}/5 — ${(message || "no comment").slice(0, 100)}`,
      link: "/admin/clients",
    });

    return res.status(201).json({ message: "Thanks for the feedback", item });
  } catch (err) {
    console.error("client createFeedback error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- meetings */

// GET /api/client/meetings
export const listMeetings = async (req, res) => {
  try {
    const query = { client: req.client._id };
    if (req.query.status && req.query.status !== "all") query.status = req.query.status;

    const items = await Meeting.find(query)
      .populate("project", "name code")
      .populate("organizer", "name designation email")
      .sort({ scheduledAt: -1 });

    const now = new Date();

    return res.status(200).json({
      items,
      total: items.length,
      page: 1,
      pages: 1,
      summary: {
        upcoming: items.filter((m) => m.status === "scheduled" && m.scheduledAt >= now).length,
        requested: items.filter((m) => m.status === "requested").length,
        completed: items.filter((m) => m.status === "completed").length,
      },
    });
  } catch (err) {
    console.error("client listMeetings error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/client/meetings — clients request, the company confirms
export const requestMeeting = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);
    const { title, agenda, project, scheduledAt, durationMinutes, mode } = req.body;

    if (!title || !scheduledAt) {
      return res.status(400).json({ message: "Give the meeting a title and a preferred time" });
    }
    if (new Date(scheduledAt) < new Date()) {
      return res.status(400).json({ message: "Pick a time in the future" });
    }
    if (project && !onMyProject(projectIds, project)) {
      return res.status(400).json({ message: "That project is not one of yours" });
    }

    /**
     * An online meeting gets its link the moment it is asked for, rather than
     * when somebody at the company gets round to confirming it.
     *
     * The request already carries a time and a subject; the one thing missing
     * to actually hold it was somewhere to hold it. Filling that in here means
     * a client who asks for a call at four o'clock can be joined at four
     * o'clock, whether or not anybody pressed Confirm first.
     */
    const wants = mode || "online";

    const created = await Meeting.create({
      title,
      agenda: agenda || "",
      client: req.client._id,
      project: project || undefined,
      scheduledAt,
      durationMinutes: Number(durationMinutes) || 30,
      mode: wants,
      location: newMeetLink(wants),
      status: "requested",
      requestedByClient: true,
    });

    const item = await Meeting.findById(created._id).populate("project", "name code");

    logActivity(req, {
      action: "created",
      entity: "Meeting",
      entityId: created._id,
      message: `${req.client.name} requested a meeting: ${title}`,
    });

    // Whoever leads the project, plus the admins, should see the request
    const leaderId = project
      ? (await Project.findById(project).select("operationsManager"))?.operationsManager
      : null;

    notifyUsers([...(await adminIds()), leaderId], {
      type: "system",
      title: `Meeting requested by ${req.client.name}`,
      message: `${title} — ${new Date(scheduledAt).toLocaleString("en-IN")}`,
      // Straight to the request, with the join button on it
      link: "/admin/clients/meetings",
    });

    return res.status(201).json({ message: "Meeting requested", item });
  } catch (err) {
    console.error("client requestMeeting error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/client/meetings/:id/cancel — a client may only withdraw their own
export const cancelMeeting = async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ _id: req.params.id, client: req.client._id });
    if (!meeting) return res.status(404).json({ message: "Meeting not found" });

    if (["completed", "cancelled"].includes(meeting.status)) {
      return res.status(400).json({ message: "That meeting is already closed" });
    }

    meeting.status = "cancelled";
    await meeting.save();

    logActivity(req, {
      action: "updated",
      entity: "Meeting",
      entityId: meeting._id,
      message: `${req.client.name} cancelled "${meeting.title}"`,
    });

    notifyUsers(await adminIds(), {
      type: "system",
      title: `Meeting cancelled by ${req.client.name}`,
      message: meeting.title,
      link: "/admin/clients/meetings",
    });

    return res.status(200).json({ message: "Meeting cancelled", item: meeting });
  } catch (err) {
    console.error("client cancelMeeting error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------- notifications */

export const listNotifications = async (req, res) => {
  try {
    const query = { user: req.client._id, userModel: "Client" };
    if (req.query.filter === "unread") query.read = false;
    if (req.query.type && req.query.type !== "all") query.type = req.query.type;

    const [items, unread] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).limit(100),
      Notification.countDocuments({ user: req.client._id, userModel: "Client", read: false }),
    ]);

    return res.status(200).json({ items, unread });
  } catch (err) {
    console.error("client listNotifications error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const updated = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.client._id, userModel: "Client" },
      { $set: { read: true } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: "Notification not found" });
    return res.status(200).json({ message: "Marked as read", item: updated });
  } catch (err) {
    console.error("client markNotificationRead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const markAllRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { user: req.client._id, userModel: "Client", read: false },
      { $set: { read: true } }
    );
    return res.status(200).json({ message: "All caught up", updated: result.modifiedCount });
  } catch (err) {
    console.error("client markAllRead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- lookups */

export const getLookups = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);

    const projects = await Project.find({ _id: { $in: projectIds } })
      .select("name code")
      .sort({ name: 1 });

    return res.status(200).json({ projects });
  } catch (err) {
    console.error("client getLookups error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
