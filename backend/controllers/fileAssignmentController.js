import fs from "fs";

import FileDoc from "../models/FileDoc.js";
import Project from "../models/Project.js";
import User, { ADMIN_ROLES } from "../models/User.js";
import { logActivity } from "../utils/activity.js";
import { notifyUser, notifyUsers } from "../utils/notify.js";
import { removeStoredFile, storedPath } from "../utils/uploads.js";
import { getScope as employeeScope } from "../middleware/employeeAuth.js";
import { getScope as leaderScope } from "../middleware/leaderAuth.js";

/**
 * Uploading a ZIP from the admin panel and handing it to one person, plus the
 * download and sign-off the other end of that hand-over needs.
 *
 * The download handler is shared by all three panels: whoever is asking, the
 * same check decides, so a file cannot be pulled by URL from a panel that is
 * not allowed to see it.
 */

const idOf = (value) => String(value?._id || value || "");

const POPULATE = [
  { path: "client", select: "name company" },
  { path: "project", select: "name code" },
  { path: "uploadedBy", select: "name" },
  { path: "assignedTo", select: "name email role designation" },
  { path: "assignedBy", select: "name" },
];

const withRefs = (query) => POPULATE.reduce((q, p) => q.populate(p), query);

const panelLink = (role) => (role === "operations_manager" ? "/operation-manager/files" : "/employee/files");

/** Confirms the person about to receive the file really can. */
const resolveAssignee = async (assignedTo, assignedRole) => {
  if (!assignedTo) return { assignee: null };

  if (!["operations_manager", "employee"].includes(assignedRole)) {
    return { error: "Choose whether you are assigning to an operations manager or an employee" };
  }

  const assignee = await User.findOne({
    _id: assignedTo,
    role: assignedRole,
    status: "active",
  }).select("name role email");

  if (!assignee) {
    return { error: "That person is not an active operations manager or employee" };
  }
  return { assignee };
};

/* ------------------------------------------------------------ admin: upload */

// POST /api/admin/files/upload   (multipart/form-data, field name "file")
export const uploadFile = async (req, res) => {
  // Anything that rejects the request below has to take the temp file with it
  const discard = () => req.file && removeStoredFile(req.file.filename);

  try {
    if (!req.file) {
      return res.status(400).json({ message: "Attach a .zip file" });
    }

    const { client, project, category, description, assignedTo, assignedRole, assignmentNote } =
      req.body;

    const title = (req.body.title || "").trim() || req.file.originalname;

    if (project) {
      const exists = await Project.exists({ _id: project });
      if (!exists) {
        discard();
        return res.status(400).json({ message: "That project no longer exists" });
      }
    }

    const { assignee, error } = await resolveAssignee(assignedTo, assignedRole);
    if (error) {
      discard();
      return res.status(400).json({ message: error });
    }

    // The same archive sent twice for the same project is almost always a
    // double click, not a second hand-over.
    const duplicate = await FileDoc.findOne({
      originalName: req.file.originalname,
      size: req.file.size,
      project: project || null,
      status: { $ne: "completed" },
    }).select("title createdAt");

    if (duplicate) {
      discard();
      return res.status(409).json({
        message: `"${req.file.originalname}" is already uploaded against this project and still open`,
      });
    }

    const created = await FileDoc.create({
      title,
      description: (description || "").trim(),
      category: category || "other",
      fileType: "zip",
      size: req.file.size,
      client: client || undefined,
      project: project || undefined,
      uploadedBy: req.admin._id,
      storedName: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      assignedTo: assignee?._id,
      assignedRole: assignee ? assignedRole : undefined,
      assignedBy: assignee ? req.admin._id : undefined,
      assignedAt: assignee ? new Date() : undefined,
      assignmentNote: assignee ? (assignmentNote || "").trim() : "",
      status: assignee ? "assigned" : "available",
    });

    logActivity(req, {
      action: "created",
      entity: "File",
      entityId: created._id,
      message: assignee
        ? `${req.admin.name} uploaded "${title}" and assigned it to ${assignee.name}`
        : `${req.admin.name} uploaded "${title}"`,
    });

    if (assignee) {
      notifyUser(assignee._id, {
        type: "task",
        title: "A file has been assigned to you",
        message: `"${title}"${assignmentNote ? ` — ${assignmentNote}` : ""}`,
        link: panelLink(assignee.role),
      });
    }

    const item = await withRefs(FileDoc.findById(created._id));
    return res.status(201).json({
      message: assignee ? `Uploaded and assigned to ${assignee.name}` : "File uploaded",
      item,
    });
  } catch (err) {
    console.error("uploadFile error:", err);
    discard();
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------ admin: assign */

// PUT /api/admin/files/:id/assign   { assignedTo, assignedRole, assignmentNote }
export const assignFile = async (req, res) => {
  try {
    const file = await FileDoc.findById(req.params.id);
    if (!file) return res.status(404).json({ message: "File not found" });

    const { assignedTo, assignedRole, assignmentNote } = req.body;

    // An empty assignee is how the admin takes the file back off someone
    if (!assignedTo) {
      file.assignedTo = undefined;
      file.assignedRole = undefined;
      file.assignedBy = undefined;
      file.assignedAt = undefined;
      file.assignmentNote = "";
      file.status = "available";
      file.downloadedAt = undefined;
      file.completedAt = undefined;
      file.completionNote = "";
      await file.save();

      logActivity(req, {
        action: "updated",
        entity: "File",
        entityId: file._id,
        message: `${req.admin.name} unassigned "${file.title}"`,
      });

      const cleared = await withRefs(FileDoc.findById(file._id));
      return res.status(200).json({ message: "Assignment removed", item: cleared });
    }

    const { assignee, error } = await resolveAssignee(assignedTo, assignedRole);
    if (error) return res.status(400).json({ message: error });

    if (idOf(file.assignedTo) === idOf(assignee._id) && file.status !== "completed") {
      return res.status(400).json({ message: `"${file.title}" is already with ${assignee.name}` });
    }

    file.assignedTo = assignee._id;
    file.assignedRole = assignedRole;
    file.assignedBy = req.admin._id;
    file.assignedAt = new Date();
    file.assignmentNote = (assignmentNote || "").trim();
    // Handing it to someone new restarts the cycle for them
    file.status = "assigned";
    file.downloadedAt = undefined;
    file.completedAt = undefined;
    file.completionNote = "";

    await file.save();

    logActivity(req, {
      action: "updated",
      entity: "File",
      entityId: file._id,
      message: `${req.admin.name} assigned "${file.title}" to ${assignee.name}`,
    });

    notifyUser(assignee._id, {
      type: "task",
      title: "A file has been assigned to you",
      message: `"${file.title}"${file.assignmentNote ? ` — ${file.assignmentNote}` : ""}`,
      link: panelLink(assignee.role),
    });

    const item = await withRefs(FileDoc.findById(file._id));
    return res.status(200).json({ message: `Assigned to ${assignee.name}`, item });
  } catch (err) {
    console.error("assignFile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------------- download */

/**
 * One rule for every panel: an admin may take anything, the person it was
 * assigned to may take theirs, and everyone else only reaches files sitting on
 * a project they already work on.
 */
const canRead = async (req, file) => {
  if (req.admin) return true;

  const user = req.leader || req.employee;
  if (!user) return false;

  if (idOf(file.assignedTo) === idOf(user._id)) return true;
  if (!file.project) return false;

  const { projectIds } = req.leader ? await leaderScope(req) : await employeeScope(req);
  return projectIds.some((id) => idOf(id) === idOf(file.project));
};

// GET /api/{admin|leader|employee}/files/:id/download
export const downloadFile = async (req, res) => {
  try {
    const file = await FileDoc.findById(req.params.id);
    if (!file) return res.status(404).json({ message: "File not found" });

    if (!(await canRead(req, file))) {
      return res.status(403).json({ message: "You do not have access to this file" });
    }

    if (!file.storedName) {
      return res.status(400).json({ message: "This entry is a link, not an uploaded file" });
    }

    const target = storedPath(file.storedName);
    if (!target) {
      return res.status(404).json({ message: "The uploaded file is missing from the server" });
    }

    // First pull by the person responsible moves the hand-over along. An admin
    // checking the archive must not flip someone else's status.
    const actor = req.leader || req.employee;
    if (actor && idOf(file.assignedTo) === idOf(actor._id) && file.status === "assigned") {
      file.status = "downloaded";
      file.downloadedAt = new Date();
      await file.save();

      logActivity(req, {
        action: "updated",
        entity: "File",
        entityId: file._id,
        message: `${actor.name} downloaded "${file.title}"`,
      });

      if (file.assignedBy) {
        notifyUser(file.assignedBy, {
          type: "system",
          title: "Assigned file downloaded",
          message: `${actor.name} downloaded "${file.title}"`,
          link: "/admin/files",
        });
      }
    }

    res.setHeader("Content-Type", file.mimeType || "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(file.originalName || `${file.title}.zip`).replace(/"/g, "")}"`
    );

    const stream = fs.createReadStream(target);
    stream.on("error", (err) => {
      console.error("downloadFile stream error:", err.message);
      if (!res.headersSent) res.status(500).json({ message: "Could not read the file" });
    });
    return stream.pipe(res);
  } catch (err) {
    console.error("downloadFile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------------- complete */

// PUT /api/{leader|employee}/files/:id/complete   { note }
export const completeFile = async (req, res) => {
  try {
    const actor = req.leader || req.employee;

    const file = await FileDoc.findOne({ _id: req.params.id, assignedTo: actor._id });
    if (!file) {
      return res.status(404).json({ message: "File not found, or it is not assigned to you" });
    }

    if (file.status === "completed") {
      return res.status(400).json({ message: "You already marked this one complete" });
    }

    file.status = "completed";
    file.completedAt = new Date();
    file.completionNote = (req.body.note || "").trim();
    await file.save();

    logActivity(req, {
      action: "updated",
      entity: "File",
      entityId: file._id,
      message: `${actor.name} marked "${file.title}" complete`,
    });

    const admins = await User.find({ role: { $in: ADMIN_ROLES } }).distinct("_id");
    notifyUsers(admins, {
      type: "task",
      title: "Assigned file completed",
      message: `${actor.name} finished "${file.title}"${
        file.completionNote ? ` — ${file.completionNote}` : ""
      }`,
      link: "/admin/files",
    });

    const item = await withRefs(FileDoc.findById(file._id));
    return res.status(200).json({ message: "Marked as completed", item });
  } catch (err) {
    console.error("completeFile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
