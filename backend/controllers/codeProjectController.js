import fs from "fs";

import CodeProject from "../models/CodeProject.js";
import Project from "../models/Project.js";
import ProjectRequest from "../models/ProjectRequest.js";
import User, { ADMIN_ROLES } from "../models/User.js";
import { can, permissionsFor } from "../middleware/permissions.js";
import { logActivity } from "../utils/activity.js";
import { assignedByFor, syncAssignments } from "../utils/projectTeam.js";
import { notifyUser, notifyUsers } from "../utils/notify.js";
import { removeStoredFile, storedPath } from "../utils/uploads.js";
import { extractZip } from "../utils/archive.js";
import { purgeVersions, recordOriginalVersion } from "./projectVersionController.js";
import { stopProject as stopRunner } from "../utils/runner.js";
import {
  buildTree,
  detectStack,
  measure,
  removeWorkspace,
  workspaceDir,
} from "../utils/workspaceFs.js";

/**
 * Code projects: an uploaded archive turned into a workspace people open in
 * the browser instead of being sent the ZIP over chat.
 *
 * Phase 1 is the admin's half — create, list, inspect, delete. The assigned
 * user's half (their own project list, the workspace itself) builds on the
 * same records without changing them.
 */

const POPULATE = [
  { path: "project", select: "name code" },
  { path: "teamLeaders", select: "name email designation role" },
  { path: "employees", select: "name email designation role" },
  { path: "createdBy", select: "name" },
  // The bin has to name whoever deleted it, not just when
  { path: "deletedBy", select: "name email role designation" },
];

const withRefs = (query) => POPULATE.reduce((q, p) => q.populate(p), query);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Multipart sends arrays as JSON strings; a plain JSON body sends arrays. */
const parseIds = (raw) => {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : (() => {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return String(raw).split(",");
    }
  })();

  return [...new Set(list.map((v) => String(v?._id || v || "").trim()).filter(Boolean))];
};

/** Only real, active staff of the right kind may be put on a project. */
const resolveStaff = async (ids, role) => {
  if (!ids.length) return [];
  return User.find({ _id: { $in: ids }, role, status: "active" }).distinct("_id");
};

const parseBool = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  return value === true || value === "true" || value === "1";
};

/* ------------------------------------------------------------- access gate */

const idOf = (value) => String(value?._id || value || "");

/** Whichever panel authenticated the request. */
const actorOf = (req) => req.admin || req.leader || req.employee;

/**
 * The one place that decides whether somebody may touch a code project.
 *
 * Every read and every write goes through this, on every panel, so there is no
 * route where "assigned" is checked differently — or forgotten. Hiding a
 * button in the UI is not access control; this is.
 *
 * Returns null when the viewer has no business seeing the project at all.
 */
export const accessFor = (doc, user) => {
  if (!doc || !user) return null;

  const trashed = Boolean(doc.deletedAt);

  // The admin owns the project, so the per-project permissions — which exist to
  // limit assigned staff — never apply to them.
  if (ADMIN_ROLES.includes(user.role)) {
    /**
     * A project in the bin is frozen rather than gone: the admin can still
     * read it — the file tree, a file, the original archive — because that is
     * how you decide whether to restore it or destroy it. What is withheld is
     * every way of changing it. Editing something that is halfway deleted just
     * produces work nobody can be sure survives.
     */
    if (trashed) {
      return { level: "admin", trashed: true, canEdit: false, canCreateDelete: false, canRun: false };
    }
    return { level: "admin", trashed: false, canEdit: true, canCreateDelete: true, canRun: true };
  }

  /**
   * For everyone else, deleted is deleted. Returning null here — rather than a
   * reduced set of permissions — is what stops a leader carrying on in a
   * workspace that has been deleted out from under them: the same 404 they
   * would get for a project that was never theirs.
   */
  if (trashed) return null;

  const assigned =
    (user.role === "team_leader" &&
      (doc.teamLeaders || []).some((id) => idOf(id) === idOf(user._id))) ||
    (user.role === "employee" && (doc.employees || []).some((id) => idOf(id) === idOf(user._id)));

  if (!assigned) return null;

  // What an assigned person may do is the admin's per-project choice
  const perms = doc.permissions || {};
  return {
    level: user.role,
    trashed: false,
    canEdit: perms.canEdit !== false,
    canCreateDelete: perms.canCreateDelete === true,
    canRun: perms.canRun !== false,
  };
};

/**
 * The refusal a write gets when the project is in the bin.
 *
 * accessFor() already answers false to canEdit, canCreateDelete and canRun on
 * a binned project, so every gate in the app refuses on its own. This exists
 * only so the refusal says why: "you do not have permission to edit this
 * project" is wrong and unhelpful when the truth is that the admin deleted it
 * and one click puts it back.
 *
 * 409 rather than 403 — nothing is wrong with who you are, only with the state
 * the project is in.
 */
export const binnedError = (access) =>
  access?.trashed
    ? {
        status: 409,
        message: "This project is in the bin — restore it before changing anything in it",
        trashed: true,
      }
    : null;

/** Mongo filter matching only the projects this account is assigned to. */
const scopeFor = (user) => {
  if (ADMIN_ROLES.includes(user.role)) return {};

  // null also matches the field being absent, so projects that predate the bin
  // are live — which is what they are.
  if (user.role === "team_leader") return { teamLeaders: user._id, deletedAt: null };
  if (user.role === "employee") return { employees: user._id, deletedAt: null };
  // Any other role is assigned to nothing, and this filter can match nothing
  return { _id: null };
};

/**
 * Load a project and check the caller against it in one step, so a handler
 * cannot accidentally read the document before deciding it is allowed to.
 */
const loadFor = async (req, id) => {
  const user = actorOf(req);
  const doc = await CodeProject.findById(id);

  // Same answer whether the project is missing or simply not theirs — an
  // unassigned user must not be able to probe which ids exist.
  if (!doc) return { error: { status: 404, message: "Code project not found" } };

  const access = accessFor(doc, user);
  if (!access) return { error: { status: 404, message: "Code project not found" } };

  return { doc, access, user };
};

/* ------------------------------------------------- admin module permissions */

/**
 * The route-level guard reads the action off the HTTP verb, which is right for
 * ordinary CRUD and wrong for the bin: restoring and approving are POSTs, and
 * a POST means "create". An admin holding only view+create on code projects
 * would otherwise be able to approve a delete request — that is, to delete —
 * without ever holding the delete permission.
 *
 * So the handlers that do something the verb does not describe say what they
 * actually need, and say it here.
 */
export const requireModuleAction = async (req, res, action) => {
  const permissions = await permissionsFor(req);

  if (permissions.broken) {
    res.status(403).json({ message: permissions.broken });
    return false;
  }
  if (can(permissions, "code_projects", action)) return true;

  res.status(403).json({
    message: `Your role does not allow you to ${action} code projects`,
    module: "code_projects",
    action,
  });
  return false;
};

/* ----------------------------------------------------------- notifications */

const panelOf = (role) =>
  role === "team_leader" ? "/team-leader/code-projects" : "/employee/code-projects";

/** Tell people work landed on their desk. Only the newly added ones. */
const announceAssignment = async (project, addedIds, actorName) => {
  if (!addedIds.length) return;

  const people = await User.find({ _id: { $in: addedIds } }).select("name role");

  people.forEach((person) => {
    notifyUser(person._id, {
      type: "task",
      title: "A code project was assigned to you",
      message: `${actorName} assigned you "${project.name}"`,
      link: panelOf(person.role),
    });
  });
};

/**
 * Tell everybody working on a project that something happened to it. Used when
 * a project goes into the bin or comes back out — those are the two events an
 * assignee finds out about by their workspace disappearing, if nobody says.
 */
const announceToAssignees = async (project, payload, { except } = {}) => {
  const skip = idOf(except);
  const ids = [...(project.teamLeaders || []), ...(project.employees || [])].filter(
    // Whoever did the thing does not need telling that they did it
    (id) => idOf(id) !== skip
  );
  if (!ids.length) return;

  const people = await User.find({ _id: { $in: ids } }).select("role");
  people.forEach((person) =>
    notifyUser(person._id, { ...payload, link: panelOf(person.role) })
  );
};

/** Everything in the bin is the admin's problem, so every admin hears about it. */
const alertAdmins = async (payload) => {
  const admins = await User.find({ role: { $in: ADMIN_ROLES }, status: "active" }).distinct("_id");
  notifyUsers(admins, { ...payload, link: "/admin/code-projects/requests" });
};

/**
 * Move a project to the bin.
 *
 * One implementation, shared by the admin's delete button, an assignee's, and
 * the approval of a delete request — so "deleted" cannot quietly come to mean
 * three slightly different things depending on which button was pressed. In
 * particular there is no path through here that removes a file.
 */
export const binProject = async (project, actor, reason = "") => {
  // A dev server still running for a project nobody can reach any more would
  // hold a port and keep writing into a folder that may be about to go.
  await stopRunner(project._id);

  project.deletedAt = new Date();
  project.deletedBy = actor?._id;
  project.deletedByRole = actor?.role || "";
  project.deleteReason = String(reason || "").trim();
  await project.save();

  return project;
};

/** Ids in `next` that were not already in `before`. */
const newlyAdded = (before, next) => {
  const had = new Set((before || []).map(idOf));
  return (next || []).map(idOf).filter((id) => !had.has(id));
};

/* --------------------------------------------------------------- create */

/**
 * POST /api/admin/code-projects
 * POST /api/leader/code-projects   (multipart/form-data, field "file" = the zip)
 *
 * Turning an uploaded archive into a workspace. The same handler on both
 * panels, because the work — validate, extract, detect, snapshot version 1 —
 * is identical, and having two copies of it would mean two places for an
 * extraction bug to live.
 *
 * What differs is what the uploader is allowed to say about it:
 *
 *   admin   anything. Their own project or none, any team leaders, any
 *           employees, and the per-project permissions are theirs to set.
 *
 *   leader  it must belong to a project they run, they are the only team
 *           leader on it, and the permissions take their defaults. They are
 *           sending work to their team, not deciding what the workspace is
 *           allowed to do — that stays the admin's, who can change it after.
 */
export const createCodeProject = async (req, res) => {
  let created = null;
  const discardZip = () => req.file && removeStoredFile(req.file.filename);

  // Whichever panel this came through
  const actor = req.admin || req.leader;
  const byLeader = Boolean(req.leader);

  try {
    const name = (req.body.name || "").trim();
    if (!name) {
      discardZip();
      return res.status(400).json({ message: "Give the project a name" });
    }
    if (!req.file) {
      discardZip();
      return res.status(400).json({ message: "Attach the project's .zip file" });
    }

    if (req.body.project) {
      const exists = await Project.exists({ _id: req.body.project });
      if (!exists) {
        discardZip();
        return res.status(400).json({ message: "That project no longer exists" });
      }
    }

    /**
     * A leader uploads into a project they run, and nowhere else. Checked as
     * part of the query rather than after it, so a project id belonging to
     * somebody else gets the same answer as one that does not exist.
     */
    if (byLeader) {
      if (!req.body.project) {
        discardZip();
        return res
          .status(400)
          .json({ message: "Say which of your projects this code belongs to" });
      }

      const ownsIt = await Project.exists({
        _id: req.body.project,
        teamLeader: req.leader._id,
      });
      if (!ownsIt) {
        discardZip();
        return res.status(404).json({ message: "Project not found" });
      }
    }

    const [requestedLeaders, employees] = await Promise.all([
      resolveStaff(parseIds(req.body.teamLeaders), "team_leader"),
      resolveStaff(parseIds(req.body.employees), "employee"),
    ]);

    // A leader is the only leader on what they uploaded — they cannot put the
    // workspace on somebody else's desk, and they are always on their own.
    const teamLeaders = byLeader ? [req.leader._id] : requestedLeaders;

    // The workspace folder is named after the document id, so the record has to
    // exist before anything can be written to disk.
    created = await CodeProject.create({
      name,
      description: (req.body.description || "").trim(),
      project: req.body.project || undefined,
      zipStoredName: req.file.filename,
      zipOriginalName: req.file.originalname,
      zipSize: req.file.size,
      teamLeaders,
      employees,
      // What assigned staff may do is the admin's call. A leader uploading
      // takes the defaults; the admin can change them afterwards.
      permissions: byLeader
        ? { canEdit: true, canCreateDelete: false, canRun: true }
        : {
            canEdit: parseBool(req.body.canEdit, true),
            canCreateDelete: parseBool(req.body.canCreateDelete, false),
            canRun: parseBool(req.body.canRun, true),
          },
      // So each of them is told who sent it, and when
      employeeAssignments: syncAssignments([], employees, actor),
      createdBy: actor._id,
    });

    /* ------------------------------------------------------------- extract */

    const dir = workspaceDir(created._id);
    const zipOnDisk = storedPath(req.file.filename);

    if (!dir || !zipOnDisk) {
      throw new Error("The uploaded archive could not be located on disk");
    }

    const report = await extractZip(zipOnDisk, dir);

    if (!report.files) {
      // An archive that yielded nothing is a failed upload, not a project
      throw new Error(
        report.rejected.length
          ? "Nothing could be extracted — every entry was rejected as unsafe"
          : "That archive is empty"
      );
    }

    const [stackInfo, totals] = await Promise.all([detectStack(dir), measure(dir)]);

    created.workspaceReady = true;
    created.fileCount = totals.files;
    created.totalSize = totals.bytes;
    created.stack = stackInfo.stack;
    created.entryFile = stackInfo.entryFile || "";
    created.rootDir = stackInfo.rootDir || "";
    created.packageScripts = stackInfo.scripts || {};
    created.extractReport = { skipped: report.skipped, rejected: report.rejected };
    await created.save();

    // Version 1 is the upload itself — the floor every later change sits on
    await recordOriginalVersion(created, actor);

    logActivity(req, {
      action: "created",
      entity: "Code Project",
      entityId: created._id,
      message: `${actor.name} created code project "${name}" from ${req.file.originalname} (${totals.files} files, ${stackInfo.stack})`,
    });

    // Only once the project is genuinely usable is it worth telling anyone
    await announceAssignment(created, [...teamLeaders, ...employees].map(idOf), actor.name);

    const item = await withRefs(CodeProject.findById(created._id));

    return res.status(201).json({
      message: `"${name}" extracted — ${totals.files} files`,
      item,
      report: {
        files: report.files,
        directories: report.directories,
        skipped: report.skipped,
        rejected: report.rejected,
      },
    });
  } catch (err) {
    console.error("createCodeProject error:", err);

    /**
     * A half-made project helps nobody: the record, the workspace and the
     * archive go back out together.
     *
     * The workspace is removed first and its result checked, because a folder
     * left behind after the record is gone is an orphan nobody will ever find
     * to clean up — the id it was named after no longer exists anywhere.
     */
    if (created) {
      await removeWorkspace(created._id);

      const stranded = workspaceDir(created._id);
      if (stranded && fs.existsSync(stranded)) {
        console.error(`createCodeProject: could not remove ${stranded} — left on disk`);
      }

      await CodeProject.deleteOne({ _id: created._id }).catch(() => {});
    }
    discardZip();

    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(400).json({ message: err.message || "Could not read that archive" });
  }
};

/* ----------------------------------------------------------------- admin: read */

// GET /api/admin/code-projects
export const listCodeProjects = async (req, res) => {
  try {
    const query = {};

    /**
     * The bin is a separate view rather than a flag on the rows, so every
     * screen that already calls this — and every one added later — gets the
     * live list by default and cannot show a deleted project by forgetting to
     * filter. Asking for it is deliberate: ?view=trash.
     */
    const wantsTrash = req.query.view === "trash";
    query.deletedAt = wantsTrash ? { $ne: null } : null;

    if (req.query.stack && req.query.stack !== "all") query.stack = req.query.stack;
    if (req.query.status && req.query.status !== "all") query.status = req.query.status;

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [{ name: regex }, { description: regex }, { zipOriginalName: regex }];
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);

    const [items, total, trashCount] = await Promise.all([
      withRefs(CodeProject.find(query))
        .sort(wantsTrash ? { deletedAt: -1 } : { createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      CodeProject.countDocuments(query),
      // Travels with the live list too, so the panel can say the bin is not
      // empty without a second round trip
      CodeProject.countDocuments({ deletedAt: { $ne: null } }),
    ]);

    return res.status(200).json({
      items,
      total,
      trashCount,
      view: wantsTrash ? "trash" : "active",
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error("listCodeProjects error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/admin/code-projects/:id
export const getCodeProject = async (req, res) => {
  try {
    const item = await withRefs(CodeProject.findById(req.params.id));
    if (!item) return res.status(404).json({ message: "Code project not found" });

    return res.status(200).json({ item });
  } catch (err) {
    console.error("getCodeProject error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/admin/code-projects/:id/tree
export const getCodeProjectTree = async (req, res) => {
  try {
    const item = await CodeProject.findById(req.params.id).select("name workspaceReady");
    if (!item) return res.status(404).json({ message: "Code project not found" });

    const dir = workspaceDir(item._id);
    if (!dir || !item.workspaceReady || !fs.existsSync(dir)) {
      return res.status(404).json({ message: "This project has no extracted workspace" });
    }

    const { tree, count, truncated } = await buildTree(dir);
    return res.status(200).json({ tree, count, truncated });
  } catch (err) {
    console.error("getCodeProjectTree error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/admin/code-projects/:id/archive  -> the original, untouched upload
/**
 * The archive as it was uploaded.
 *
 * This used to be admin-only by nothing more than which router it sat on, so
 * the handler itself trusted whoever reached it. Assigned staff need it too —
 * the ZIP is how work leaves this app for a local editor — and the moment the
 * route exists on their routers, "whoever reached it" stops being a check.
 * loadFor answers the same 404 for a project that does not exist and one that
 * is not yours, so an id cannot be probed either.
 *
 * No new reach: an assigned account can already open every file in the
 * workspace and download a version snapshot, which is a ZIP of the same tree.
 */
export const downloadOriginalZip = async (req, res) => {
  try {
    const { doc: item, error } = await loadFor(req, req.params.id);
    if (error) return res.status(error.status).json({ message: error.message });

    const target = storedPath(item.zipStoredName);
    if (!target) return res.status(404).json({ message: "The original archive is missing" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(item.zipOriginalName || `${item.name}.zip`).replace(/"/g, "")}"`
    );

    const stream = fs.createReadStream(target);
    stream.on("error", (err) => {
      console.error("downloadOriginalZip stream error:", err.message);
      if (!res.headersSent) res.status(500).json({ message: "Could not read the archive" });
    });
    return stream.pipe(res);
  } catch (err) {
    console.error("downloadOriginalZip error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------- assigned staff: their own list */

/**
 * GET /api/{leader|employee}/code-projects
 *
 * Driven purely by the assignment lists, exactly like listSharedWithMe does
 * for code submissions: leading a business project grants nothing here, only
 * being named on this code project does.
 */
export const listMyCodeProjects = async (req, res) => {
  try {
    const user = actorOf(req);
    const query = scopeFor(user);

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [{ name: regex }, { description: regex }];
    }

    const items = await withRefs(CodeProject.find(query)).sort({ updatedAt: -1 }).limit(100);

    // Their own outstanding asks, so a card can say "waiting on the admin"
    // instead of offering a button that answers 409.
    const pending = await ProjectRequest.find({
      codeProject: { $in: items.map((doc) => doc._id) },
      requestedBy: user._id,
      status: "pending",
    }).select("codeProject type reason createdAt");

    const pendingBy = pending.reduce((acc, row) => {
      const key = idOf(row.codeProject);
      (acc[key] ||= []).push({
        _id: row._id,
        type: row.type,
        reason: row.reason,
        createdAt: row.createdAt,
      });
      return acc;
    }, {});

    // What this person may do travels with each row, so the UI can render the
    // right buttons — while the server keeps deciding what actually happens.
    const rows = items.map((doc) => {
      const access = accessFor(doc, user);
      const row = doc.toObject();

      // Who handed them this workspace, and when. Nobody else's record is
      // their business, so the list itself does not travel.
      const from = assignedByFor(row.employeeAssignments, user._id);
      delete row.employeeAssignments;

      return {
        ...row,
        myAccess: access,
        myPendingRequests: pendingBy[idOf(doc._id)] || [],
        assignedBy: from.assignedBy,
        assignedAt: from.assignedAt,
      };
    });

    return res.status(200).json({ items: rows, total: rows.length });
  } catch (err) {
    console.error("listMyCodeProjects error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/{leader|employee}/code-projects/:id
export const getMyCodeProject = async (req, res) => {
  try {
    const { doc, access, error } = await loadFor(req, req.params.id);
    if (error) return res.status(error.status).json({ message: error.message });

    const item = await withRefs(CodeProject.findById(doc._id));
    return res.status(200).json({ item: { ...item.toObject(), myAccess: access } });
  } catch (err) {
    console.error("getMyCodeProject error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/{leader|employee}/code-projects/:id/tree
export const getMyCodeProjectTree = async (req, res) => {
  try {
    const { doc, error } = await loadFor(req, req.params.id);
    if (error) return res.status(error.status).json({ message: error.message });

    const dir = workspaceDir(doc._id);
    if (!dir || !doc.workspaceReady || !fs.existsSync(dir)) {
      return res.status(404).json({ message: "This project has no extracted workspace" });
    }

    const { tree, count, truncated } = await buildTree(dir);
    return res.status(200).json({ tree, count, truncated });
  } catch (err) {
    console.error("getMyCodeProjectTree error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- admin: write */

// PUT /api/admin/code-projects/:id   (details and assignment, never the files)
export const updateCodeProject = async (req, res) => {
  try {
    const item = await CodeProject.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Code project not found" });

    // Editing something that is halfway deleted produces changes nobody can be
    // sure survive. Restore is one click, and then this is an ordinary edit.
    if (item.deletedAt) {
      return res.status(409).json({
        message: "This project is in the bin — restore it before editing it",
        trashed: true,
      });
    }

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ message: "Give the project a name" });
      item.name = name;
    }
    if (req.body.description !== undefined) {
      item.description = String(req.body.description).trim();
    }
    if (req.body.project !== undefined) {
      item.project = req.body.project || undefined;
    }
    if (req.body.status !== undefined && ["active", "archived"].includes(req.body.status)) {
      item.status = req.body.status;
    }

    // Snapshot before reassigning so only genuinely new people are told —
    // re-saving the form must not notify everybody again.
    const added = [];

    if (req.body.teamLeaders !== undefined) {
      const next = await resolveStaff(parseIds(req.body.teamLeaders), "team_leader");
      added.push(...newlyAdded(item.teamLeaders, next));
      item.teamLeaders = next;
    }
    if (req.body.employees !== undefined) {
      const next = await resolveStaff(parseIds(req.body.employees), "employee");
      added.push(...newlyAdded(item.employees, next));
      item.employees = next;
    }

    if (req.body.permissions) {
      const p = req.body.permissions;
      item.permissions = {
        canEdit: parseBool(p.canEdit, item.permissions.canEdit),
        canCreateDelete: parseBool(p.canCreateDelete, item.permissions.canCreateDelete),
        canRun: parseBool(p.canRun, item.permissions.canRun),
      };
    }

    await item.save();

    logActivity(req, {
      action: "updated",
      entity: "Code Project",
      entityId: item._id,
      message: `${req.admin.name} updated code project "${item.name}"${
        added.length ? ` and assigned ${added.length} more` : ""
      }`,
    });

    await announceAssignment(item, added, req.admin.name);

    const fresh = await withRefs(CodeProject.findById(item._id));
    return res.status(200).json({ message: "Code project updated", item: fresh });
  } catch (err) {
    console.error("updateCodeProject error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- the bin */

/**
 * DELETE /api/admin/code-projects/:id
 *
 * Deleting used to destroy the record, the workspace, every snapshot and the
 * original archive in one go, the instant the button was pressed. This moves
 * the project to the bin instead.
 *
 * The route, the verb and the button are all unchanged — what changed is that
 * the act is now undoable, and that destroying the bytes is a second decision
 * taken deliberately (see purgeCodeProject).
 */
export const removeCodeProject = async (req, res) => {
  try {
    const item = await CodeProject.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Code project not found" });
    if (item.deletedAt) {
      return res.status(400).json({ message: "That project is already in the bin" });
    }

    await binProject(item, req.admin, req.body?.reason);

    logActivity(req, {
      action: "deleted",
      entity: "Code Project",
      entityId: item._id,
      message: `${req.admin.name} moved code project "${item.name}" to the bin`,
    });

    // Their workspace vanishes from their panel either way — better they hear
    // it from the app than find out by clicking
    await announceToAssignees(item, {
      type: "project",
      title: "A code project was removed",
      message: `"${item.name}" was deleted by ${req.admin.name}`,
    });

    return res.status(200).json({
      message: `"${item.name}" moved to the bin — restore it or delete it for good from Requests & Bin`,
      item: { _id: item._id, name: item.name, deletedAt: item.deletedAt },
    });
  } catch (err) {
    console.error("removeCodeProject error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * DELETE /api/{leader|employee}/code-projects/:id
 *
 * An assignee deleting the project they were given.
 *
 * This is the only delete route on either of those panels, and it is a soft
 * one. There is no flag it can be sent, no second route beside it, and no
 * branch inside it that removes a byte — the destructive route lives on the
 * admin router, behind adminAuth, which a leader's or an employee's token
 * cannot get past at all. So "they can delete a project" and "they can never
 * destroy one" are both true, and neither of them depends on the UI.
 *
 * loadFor() answers 404 for a project that is not theirs and for one already
 * in the bin, exactly as every other route on their panels does.
 */
export const softDeleteMyCodeProject = async (req, res) => {
  try {
    const { doc, user, error } = await loadFor(req, req.params.id);
    if (error) return res.status(error.status).json({ message: error.message });

    await binProject(doc, user, req.body?.reason);

    const role = (user.role || "").replace(/_/g, " ");

    logActivity(req, {
      action: "deleted",
      entity: "Code Project",
      entityId: doc._id,
      message: `${user.name} (${role}) deleted code project "${doc.name}" — moved to the admin's bin`,
    });

    // It is in the admin's bin now, so the admin is the one who has to know
    await alertAdmins({
      type: "project",
      title: "A project was deleted",
      message: `${user.name} deleted "${doc.name}" — it is in the bin`,
    });

    // And anybody else on it will otherwise just find their workspace gone
    await announceToAssignees(
      doc,
      {
        type: "project",
        title: "A code project was removed",
        message: `"${doc.name}" was deleted by ${user.name}`,
      },
      { except: user._id }
    );

    return res.status(200).json({
      message: `"${doc.name}" deleted — the admin can restore it if this was a mistake`,
      item: { _id: doc._id, name: doc.name, deletedAt: doc.deletedAt },
    });
  } catch (err) {
    console.error("softDeleteMyCodeProject error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/admin/code-projects/:id/restore
 *
 * The one bin route with no permission check of its own. Restoring destroys
 * nothing and creates nothing — it undoes a delete — so the module guard on
 * the route is the whole of it. A second requirement here would mean an admin
 * needed two permissions to undo what one permission did.
 */
export const restoreCodeProject = async (req, res) => {
  try {
    const item = await CodeProject.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Code project not found" });
    if (!item.deletedAt) {
      return res.status(400).json({ message: "That project is not in the bin" });
    }

    /**
     * Only the bin fields are touched. The assignment, the per-project
     * permissions, the version history and the workspace on disk were never
     * changed by the delete, so a restore has nothing to put back — which is
     * the whole reason a soft delete is worth having.
     */
    item.deletedAt = null;
    item.deletedBy = undefined;
    item.deletedByRole = "";
    item.deleteReason = "";
    await item.save();

    logActivity(req, {
      action: "updated",
      entity: "Code Project",
      entityId: item._id,
      message: `${req.admin.name} restored code project "${item.name}"`,
    });

    await announceToAssignees(item, {
      type: "project",
      title: "A code project came back",
      message: `"${item.name}" was restored by ${req.admin.name}`,
    });

    const fresh = await withRefs(CodeProject.findById(item._id));
    return res.status(200).json({ message: `"${item.name}" restored`, item: fresh });
  } catch (err) {
    console.error("restoreCodeProject error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * DELETE /api/admin/code-projects/:id/permanent
 *
 * The only thing in this app that destroys a project's bytes. Two guards, and
 * neither is a confirm dialog — a dialog is on the wrong side of the network:
 *
 *   the project must already be in the bin, so this can never be reached by a
 *   single click on a live project, and
 *
 *   the caller has to send the project's exact name back, which is a thing you
 *   cannot do by accident, by a mistyped id, or by a request replayed from a
 *   log.
 */
export const purgeCodeProject = async (req, res) => {
  try {
    if (!(await requireModuleAction(req, res, "delete"))) return;

    const item = await CodeProject.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Code project not found" });

    if (!item.deletedAt) {
      return res.status(409).json({
        message: "Delete the project first — only something already in the bin can be destroyed",
      });
    }

    const confirm = String(req.body?.confirm ?? req.query.confirm ?? "").trim();
    if (confirm !== item.name) {
      return res.status(400).json({
        message: `Type the project's name exactly — "${item.name}" — to confirm this cannot be undone`,
        needsConfirmation: true,
      });
    }

    const name = item.name;

    await stopRunner(item._id);

    // Record, workspace, snapshots and archive go together or the leftovers
    // are orphans nobody will ever find to clean up
    await purgeVersions(item._id);
    await removeWorkspace(item._id);
    if (item.zipStoredName) removeStoredFile(item.zipStoredName);
    await item.deleteOne();

    /**
     * Requests outlive the project on purpose — they are the record of who
     * asked for what — but none of them can still be waiting on a decision
     * about something that no longer exists. A pending delete request got what
     * it asked for; anything else did not.
     */
    const decided = { decidedBy: req.admin._id, decidedAt: new Date() };
    await Promise.all([
      ProjectRequest.updateMany(
        { codeProject: item._id, status: "pending", type: "delete" },
        { $set: { ...decided, status: "approved", decisionNote: "The project was deleted permanently" } }
      ),
      ProjectRequest.updateMany(
        { codeProject: item._id, status: "pending", type: { $ne: "delete" } },
        {
          $set: {
            ...decided,
            status: "rejected",
            decisionNote: "The project was deleted permanently",
          },
        }
      ),
    ]);

    logActivity(req, {
      action: "deleted",
      entity: "Code Project",
      entityId: item._id,
      message: `${req.admin.name} permanently deleted code project "${name}" and everything belonging to it`,
    });

    return res.status(200).json({ message: `"${name}" and all of its files are gone for good` });
  } catch (err) {
    console.error("purgeCodeProject error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
