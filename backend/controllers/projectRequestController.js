import CodeProject from "../models/CodeProject.js";
import ProjectRequest, { REQUEST_TYPES } from "../models/ProjectRequest.js";
import User, { ADMIN_ROLES } from "../models/User.js";
import { logActivity } from "../utils/activity.js";
import { notifyUser, notifyUsers } from "../utils/notify.js";
import { accessFor, binProject, requireModuleAction } from "./codeProjectController.js";

/**
 * "Ask the admin" — the other half of taking editing and deleting away from
 * team leaders and employees.
 *
 * Nothing here gives either of them a new power. A request is a row; the only
 * code that touches a project is the admin's decision at the bottom of this
 * file. That is the point: the panels that may not delete a project still have
 * somewhere to put "this project needs deleting", instead of it living in a
 * chat message nobody acts on.
 *
 * The four things a request deliberately cannot ask for are the assignment,
 * the team leaders, the employees and the per-project permissions. An approval
 * is a tired person clicking a green button — so that gets refused by the
 * shape of what a request can contain, not by the reviewer's attention.
 */

const POPULATE = [
  { path: "requestedBy", select: "name email role designation" },
  { path: "decidedBy", select: "name" },
  { path: "codeProject", select: "name stack deletedAt workspaceReady" },
];

const withRefs = (query) => POPULATE.reduce((q, p) => q.populate(p), query);

const actorOf = (req) => req.admin || req.leader || req.employee;

const panelOf = (role) =>
  role === "team_leader" ? "/team-leader/code-projects" : "/employee/code-projects";

const ADMIN_LINK = "/admin/code-projects/requests";

const describe = (request) =>
  request.type === "delete" ? "delete this project" : "change this project's details";

/** Every admin sees the queue, so every admin hears about a new request. */
const alertAdmins = async (payload) => {
  const admins = await User.find({ role: { $in: ADMIN_ROLES }, status: "active" }).distinct("_id");
  notifyUsers(admins, { ...payload, link: ADMIN_LINK });
};

/* ------------------------------------------------ team leader / employee */

/**
 * POST /api/{leader|employee}/code-projects/:id/requests
 *
 * Body: { type: "edit" | "delete", reason, name?, description? }
 *
 * accessFor() is the same gate every other route on this project uses, so a
 * request can only be raised by somebody already assigned — and never on a
 * project already in the bin, which it answers 404 for.
 */
export const createRequest = async (req, res) => {
  try {
    const user = actorOf(req);
    const project = await CodeProject.findById(req.params.id);

    // Same answer whether the project is missing or simply not theirs
    if (!project) return res.status(404).json({ message: "Code project not found" });
    if (!accessFor(project, user)) {
      return res.status(404).json({ message: "Code project not found" });
    }

    const type = String(req.body.type || "").trim();
    if (!REQUEST_TYPES.includes(type)) {
      return res.status(400).json({ message: "Say whether this is an edit or a delete request" });
    }

    const reason = String(req.body.reason || "").trim();
    if (!reason) {
      return res
        .status(400)
        .json({ message: "Tell the admin why — a bare request is hard to act on" });
    }

    const changes = { name: "", description: "" };

    if (type === "edit") {
      const name = String(req.body.name ?? "").trim();
      const description = String(req.body.description ?? "").trim();

      // Either field on its own is enough, but a request that asks for nothing
      // is not a request — it is a message, and there is a chat for those.
      const wantsName = Boolean(name) && name !== project.name;
      const wantsDescription =
        req.body.description !== undefined && description !== (project.description || "");

      if (!wantsName && !wantsDescription) {
        return res.status(400).json({
          message: "Change the name or the description to something different first",
        });
      }

      changes.name = wantsName ? name : "";
      changes.description = wantsDescription ? description : "";
    }

    /**
     * One pending request per person per project per type. Without this a
     * frustrated employee clicking twice puts two identical rows in front of
     * the admin, and approving the second after the first does nothing.
     */
    const existing = await ProjectRequest.findOne({
      codeProject: project._id,
      requestedBy: user._id,
      type,
      status: "pending",
    });

    if (existing) {
      return res.status(409).json({
        message: `You already have a ${type} request waiting on this project`,
        item: existing,
      });
    }

    const created = await ProjectRequest.create({
      codeProject: project._id,
      projectName: project.name,
      type,
      requestedBy: user._id,
      requestedByRole: user.role,
      reason,
      changes,
    });

    logActivity(req, {
      action: "created",
      entity: "Project Request",
      entityId: created._id,
      message: `${user.name} asked the admin to ${describe(created)} on "${project.name}"`,
    });

    await alertAdmins({
      type: "project",
      title: type === "delete" ? "Delete request" : "Edit request",
      message: `${user.name} wants to ${describe(created)}: "${project.name}"`,
    });

    const item = await withRefs(ProjectRequest.findById(created._id));
    return res.status(201).json({
      message: "Sent to the admin — you will be told what they decide",
      item,
    });
  } catch (err) {
    console.error("createRequest error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/{leader|employee}/code-projects/requests
 *
 * Only this person's own requests. A leader has no business reading what an
 * employee asked for, and the queue itself is the admin's screen.
 */
export const listMyRequests = async (req, res) => {
  try {
    const user = actorOf(req);
    const query = { requestedBy: user._id };

    if (req.query.status && req.query.status !== "all") query.status = req.query.status;

    const items = await withRefs(ProjectRequest.find(query)).sort({ createdAt: -1 }).limit(100);
    return res.status(200).json({ items, total: items.length });
  } catch (err) {
    console.error("listMyRequests error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * DELETE /api/{leader|employee}/code-projects/requests/:requestId
 *
 * Withdrawing your own request before anybody has acted on it. Scoped to the
 * requester and to "pending", so this cannot be used to erase a decision — a
 * rejected request stays on the record.
 */
export const cancelMyRequest = async (req, res) => {
  try {
    const user = actorOf(req);

    const request = await ProjectRequest.findOne({
      _id: req.params.requestId,
      requestedBy: user._id,
    });

    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "pending") {
      return res.status(400).json({ message: "The admin has already answered that one" });
    }

    await request.deleteOne();

    logActivity(req, {
      action: "deleted",
      entity: "Project Request",
      entityId: request._id,
      message: `${user.name} withdrew their ${request.type} request on "${request.projectName}"`,
    });

    return res.status(200).json({ message: "Request withdrawn" });
  } catch (err) {
    console.error("cancelMyRequest error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------------ admin */

// GET /api/admin/code-projects/requests?status=pending|approved|rejected|all
export const listRequests = async (req, res) => {
  try {
    const query = {};
    const status = req.query.status || "pending";
    if (status !== "all") query.status = status;

    if (req.query.project) query.codeProject = req.query.project;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 25);

    const [items, total, pendingCount] = await Promise.all([
      withRefs(ProjectRequest.find(query))
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      ProjectRequest.countDocuments(query),
      // Rides along so the panel can badge the queue without a second call
      ProjectRequest.countDocuments({ status: "pending" }),
    ]);

    return res.status(200).json({
      items,
      total,
      pendingCount,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error("listRequests error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/admin/code-projects/requests/:requestId/approve
 * POST /api/admin/code-projects/requests/:requestId/reject
 *
 * The decision — and the only place in the request system that touches a
 * project. Both are POSTs, which the route guard reads as "create", so each
 * asks for the permission the act actually needs before doing anything:
 * approving a delete request deletes, and wants the delete permission.
 */
const decide = (decision) => async (req, res) => {
  try {
    const request = await ProjectRequest.findById(req.params.requestId);
    if (!request) return res.status(404).json({ message: "Request not found" });

    if (request.status !== "pending") {
      return res.status(409).json({
        message: `That request was already ${request.status}`,
        item: request,
      });
    }

    const needed = decision === "approve" && request.type === "delete" ? "delete" : "edit";
    if (!(await requireModuleAction(req, res, needed))) return;

    const note = String(req.body?.note || "").trim();
    const project = await CodeProject.findById(request.codeProject);

    /**
     * The project can have gone in the time the request sat in the queue.
     * Rejecting is still meaningful — it closes the row — but there is nothing
     * left to approve.
     */
    if (!project && decision === "approve") {
      request.status = "rejected";
      request.decidedBy = req.admin._id;
      request.decidedAt = new Date();
      request.decisionNote = "That project no longer exists";
      await request.save();

      return res.status(409).json({
        message: "That project no longer exists — the request has been closed",
        item: request,
      });
    }

    let applied = "";

    if (decision === "approve" && project) {
      if (request.type === "delete") {
        if (project.deletedAt) {
          applied = "it was already in the bin";
        } else {
          // Exactly what the admin's own delete button does, through the same
          // helper: to the bin, not to the shredder. Approving somebody else's
          // request is not the moment to destroy files irreversibly.
          await binProject(project, req.admin, request.reason);
          applied = "moved to the bin";
        }
      } else {
        const changed = [];

        if (request.changes?.name) {
          project.name = request.changes.name;
          changed.push("name");
        }
        // A request that left the description alone stores "", so an empty
        // value here means "not asked for" rather than "clear it"
        if (request.changes?.description) {
          project.description = request.changes.description;
          changed.push("description");
        }

        if (!changed.length) {
          applied = "nothing left to change";
        } else {
          await project.save();
          applied = `${changed.join(" and ")} updated`;
        }
      }
    }

    request.status = decision === "approve" ? "approved" : "rejected";
    request.decidedBy = req.admin._id;
    request.decidedAt = new Date();
    request.decisionNote = note;
    await request.save();

    logActivity(req, {
      action: "updated",
      entity: "Project Request",
      entityId: request._id,
      message: `${req.admin.name} ${request.status} a ${request.type} request on "${
        request.projectName
      }"${applied ? ` — ${applied}` : ""}`,
    });

    // The person who asked hears back either way. A request that is silently
    // rejected is worse than no request system at all.
    notifyUser(request.requestedBy, {
      type: "project",
      title: decision === "approve" ? "Your request was approved" : "Your request was declined",
      message: `${request.type === "delete" ? "Delete" : "Edit"} request on "${
        request.projectName
      }"${note ? ` — ${note}` : ""}`,
      link: panelOf(request.requestedByRole),
    });

    const item = await withRefs(ProjectRequest.findById(request._id));
    return res.status(200).json({
      message:
        decision === "approve" ? `Approved${applied ? ` — ${applied}` : ""}` : "Request declined",
      item,
    });
  } catch (err) {
    console.error(`${decision} request error:`, err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const approveRequest = decide("approve");
export const rejectRequest = decide("reject");
