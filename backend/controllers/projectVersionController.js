import crypto from "crypto";
import { ADMIN_ROLES } from "../models/User.js";
import fs from "fs";
import path from "path";

import CodeProject from "../models/CodeProject.js";
import ProjectVersion from "../models/ProjectVersion.js";
import { logActivity } from "../utils/activity.js";
import { notifyUsers } from "../utils/notify.js";
import { UPLOAD_DIR, removeStoredFile, storedPath } from "../utils/uploads.js";
import { extractZip, zipDirectory } from "../utils/archive.js";
import { accessFor, binnedError } from "./codeProjectController.js";
import { measure, moveDirectory, rmWithRetry, workspaceDir } from "../utils/workspaceFs.js";

/**
 * Version history and rollback.
 *
 * The rule underneath all of it: the original upload is never modified and
 * never removed. Everything else is a snapshot layered on top, so however
 * badly a working copy is mangled, version 1 is still exactly what the admin
 * sent — which is what makes editing in the browser safe to offer at all.
 */

// Enough for real use, low enough that a project cannot quietly eat a disk.
// The limit refuses rather than deleting: silently dropping someone's history
// to make room would be worse than saying no.
const MAX_VERSIONS = 30;

const actorOf = (req) => req.admin || req.leader || req.employee;

/** Load the project and check the caller, exactly as every other route does. */
const gate = async (req, { need } = {}) => {
  const user = actorOf(req);

  const project = await CodeProject.findById(req.params.id);
  if (!project) return { error: { status: 404, message: "Code project not found" } };

  const access = accessFor(project, user);
  if (!access) return { error: { status: 404, message: "Code project not found" } };

  if (need) {
    const binned = binnedError(access);
    if (binned) return { error: binned };

    if (!access[need]) {
      return { error: { status: 403, message: "You do not have permission to do that here" } };
    }
  }

  return { project, access, user };
};

const snapshotName = () => `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.zip`;

/** Everyone assigned to the project, for the "this changed under you" notice. */
const assigneesOf = (project) => [
  ...(project.operationsManagers || []),
  ...(project.employees || []),
];

/**
 * Take a snapshot of the workspace as it stands. Shared by the manual button
 * and by the automatic safety snapshot a restore takes first.
 */
const captureVersion = async (project, user, { label, note, changedFiles }) => {
  const dir = workspaceDir(project._id);
  if (!dir || !project.workspaceReady || !fs.existsSync(dir)) {
    throw Object.assign(new Error("This project has no extracted workspace"), { status: 404 });
  }

  const count = await ProjectVersion.countDocuments({ codeProject: project._id });
  if (count >= MAX_VERSIONS) {
    throw Object.assign(
      new Error(`This project already has ${MAX_VERSIONS} versions — delete an old one first`),
      { status: 400 }
    );
  }

  const storedName = snapshotName();
  const zipPath = path.join(UPLOAD_DIR, storedName);

  let written;
  try {
    written = await zipDirectory(dir, zipPath);
  } catch (err) {
    // A snapshot that failed halfway must not leave a stub behind
    await fs.promises.rm(zipPath, { force: true }).catch(() => {});
    throw Object.assign(new Error(err.message || "Could not snapshot this project"), {
      status: 400,
    });
  }

  const version = (project.currentVersion || 1) + 1;

  const created = await ProjectVersion.create({
    codeProject: project._id,
    version,
    label: (label || `Version ${version}`).trim(),
    note: (note || "").trim(),
    storedName,
    size: written.size,
    fileCount: written.files,
    changedFiles: changedFiles || [],
    createdBy: user._id,
    createdByName: user.name,
  });

  project.currentVersion = version;
  // The list of what changed belongs to the snapshot now, so it starts again
  project.pendingChanges = [];
  await project.save();

  return created;
};

/* ------------------------------------------------------------------- list */

// GET /api/{admin|leader|employee}/code-projects/:id/versions
export const listVersions = async (req, res) => {
  try {
    const { project, access, error } = await gate(req);
    if (error) return res.status(error.status).json({ message: error.message });

    const versions = await ProjectVersion.find({ codeProject: project._id })
      .sort({ version: -1 })
      .lean();

    return res.status(200).json({
      versions,
      currentVersion: project.currentVersion,
      pendingChanges: project.pendingChanges || [],
      // Rolling back is destructive for everyone on the project, so it stays
      // with the admin. The UI reads this rather than guessing.
      canRestore: access.level === "admin",
      canSnapshot: Boolean(access.canEdit),
      maxVersions: MAX_VERSIONS,
    });
  } catch (err) {
    console.error("listVersions error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------------- snapshot */

// POST /api/{admin|leader|employee}/code-projects/:id/versions  { label, note }
export const createVersion = async (req, res) => {
  try {
    const { project, user, error } = await gate(req, { need: "canEdit" });
    if (error) return res.status(error.status).json({ message: error.message });

    const created = await captureVersion(project, user, {
      label: req.body?.label,
      note: req.body?.note,
      changedFiles: project.pendingChanges || [],
    });

    logActivity(req, {
      action: "created",
      entity: "Code Project",
      entityId: project._id,
      message: `${user.name} saved version ${created.version} of "${project.name}"`,
    });

    return res.status(201).json({
      message: `Version ${created.version} saved`,
      version: created,
      currentVersion: project.currentVersion,
    });
  } catch (err) {
    console.error("createVersion error:", err);
    return res.status(err.status || 500).json({ message: err.message || "Server error" });
  }
};

/* ---------------------------------------------------------------- download */

// GET /api/{...}/code-projects/:id/versions/:version/archive
export const downloadVersion = async (req, res) => {
  try {
    const { project, error } = await gate(req);
    if (error) return res.status(error.status).json({ message: error.message });

    const version = await ProjectVersion.findOne({
      codeProject: project._id,
      version: Number(req.params.version),
    });
    if (!version) return res.status(404).json({ message: "That version does not exist" });

    const target = storedPath(version.storedName);
    if (!target) return res.status(404).json({ message: "That snapshot is missing from the server" });

    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${slug}-v${version.version}.zip"`);

    const stream = fs.createReadStream(target);
    stream.on("error", (err) => {
      console.error("downloadVersion stream error:", err.message);
      if (!res.headersSent) res.status(500).json({ message: "Could not read that snapshot" });
    });
    return stream.pipe(res);
  } catch (err) {
    console.error("downloadVersion error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ----------------------------------------------------------------- restore */

/**
 * POST /api/admin/code-projects/:id/versions/:version/restore
 *
 * Admin only, and mounted only on the admin router: a rollback throws away
 * whatever everybody else on the project has been working on, which is not a
 * decision one assignee should be able to make for the others.
 *
 * The current state is snapshotted first, so a rollback is itself undoable.
 */
export const restoreVersion = async (req, res) => {
  try {
    const { project, access, user, error } = await gate(req);
    if (error) return res.status(error.status).json({ message: error.message });

    if (!ADMIN_ROLES.includes(user.role)) {
      return res.status(403).json({ message: "Only an admin can roll a project back" });
    }

    // gate() is asked for no permission here, so the bin has to be checked in
    // person: rolling back into a workspace that is halfway deleted writes
    // work nobody can be sure survives.
    const binned = binnedError(access);
    if (binned) return res.status(binned.status).json({ message: binned.message });

    const wanted = Number(req.params.version);
    const version = await ProjectVersion.findOne({ codeProject: project._id, version: wanted });
    if (!version) return res.status(404).json({ message: "That version does not exist" });

    const snapshot = storedPath(version.storedName);
    if (!snapshot) {
      return res.status(404).json({ message: "That snapshot is missing from the server" });
    }

    const dir = workspaceDir(project._id);
    if (!dir) return res.status(400).json({ message: "This project has no workspace" });

    // Safety net first: whatever is there now becomes a version of its own, so
    // a rollback made in error is not the end of that work.
    let safety = null;
    try {
      safety = await captureVersion(project, user, {
        label: `Before rollback to v${wanted}`,
        note: "Taken automatically so this rollback can be undone",
        changedFiles: project.pendingChanges || [],
      });
    } catch (err) {
      // A project at the version cap must still be restorable, but never at
      // the cost of losing the current state silently.
      return res.status(400).json({
        message: `Could not snapshot the current state first — ${err.message}. Delete an old version and try again.`,
      });
    }

    /**
     * Replace the workspace.
     *
     * The new state is built beside the live folder first, so anything that
     * can fail — a corrupt snapshot, a full disk — fails while the project is
     * still untouched. Only once staging is complete and verified does the
     * live folder go.
     *
     * The live folder is deleted rather than renamed aside: Windows refuses to
     * rename a directory that any handle is still inside, and the snapshot
     * taken a moment ago was reading exactly these files. Deleting retries
     * past that, and the safety version above is what makes deleting safe to
     * do at all.
     */
    const staging = `${dir}.restoring-${Date.now()}`;

    try {
      // strip: false — a snapshot's top level is already the project root
      await extractZip(snapshot, staging, { strip: false });

      const staged = await fs.promises.readdir(staging);
      if (!staged.length) throw new Error("that snapshot extracted to nothing");
    } catch (err) {
      await rmWithRetry(staging).catch(() => {});
      console.error("restoreVersion staging error:", err);
      return res.status(500).json({
        message: `Could not read that snapshot — the project is unchanged (${err.message})`,
      });
    }

    try {
      await rmWithRetry(dir);
      await moveDirectory(staging, dir);
    } catch (err) {
      await rmWithRetry(staging).catch(() => {});
      console.error("restoreVersion swap error:", err);
      return res.status(500).json({
        message: `Could not restore that version. The state before this attempt was saved as version ${safety.version} — restore that to recover.`,
      });
    }

    const totals = await measure(dir);
    project.fileCount = totals.files;
    project.totalSize = totals.bytes;
    project.pendingChanges = [];
    await project.save();

    logActivity(req, {
      action: "updated",
      entity: "Code Project",
      entityId: project._id,
      message: `${user.name} rolled "${project.name}" back to version ${wanted}`,
    });

    // Anyone with the project open is now looking at stale files
    notifyUsers(assigneesOf(project), {
      type: "system",
      title: "A project you work on was rolled back",
      message: `"${project.name}" was restored to version ${wanted} — reopen it to see the current files`,
      link: "/employee/code-projects",
    });

    return res.status(200).json({
      message: `Restored version ${wanted}. The previous state was saved as version ${safety.version}.`,
      currentVersion: project.currentVersion,
      savedAs: safety.version,
      fileCount: totals.files,
    });
  } catch (err) {
    console.error("restoreVersion error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------------ delete */

// DELETE /api/admin/code-projects/:id/versions/:version
export const removeVersion = async (req, res) => {
  try {
    const { project, access, user, error } = await gate(req);
    if (error) return res.status(error.status).json({ message: error.message });

    if (!ADMIN_ROLES.includes(user.role)) {
      return res.status(403).json({ message: "Only an admin can delete a version" });
    }

    const binned = binnedError(access);
    if (binned) return res.status(binned.status).json({ message: binned.message });

    const version = await ProjectVersion.findOne({
      codeProject: project._id,
      version: Number(req.params.version),
    });
    if (!version) return res.status(404).json({ message: "That version does not exist" });

    // The floor stays. Without it there is no guaranteed way back to what was
    // actually uploaded, and the whole promise of safe editing goes with it.
    if (version.isOriginal) {
      return res.status(400).json({ message: "The original upload cannot be deleted" });
    }

    removeStoredFile(version.storedName);
    await version.deleteOne();

    logActivity(req, {
      action: "deleted",
      entity: "Code Project",
      entityId: project._id,
      message: `${user.name} deleted version ${version.version} of "${project.name}"`,
    });

    return res.status(200).json({ message: `Version ${version.version} deleted` });
  } catch (err) {
    console.error("removeVersion error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------- used by other files */

/** Version 1: the upload itself, recorded the moment a project is created. */
export const recordOriginalVersion = async (project, user) =>
  ProjectVersion.create({
    codeProject: project._id,
    version: 1,
    label: "Original upload",
    note: `Extracted from ${project.zipOriginalName}`,
    storedName: project.zipStoredName,
    isOriginal: true,
    size: project.zipSize,
    fileCount: project.fileCount,
    createdBy: user._id,
    createdByName: user.name,
  });

/** Every snapshot belonging to a project, for when the project is deleted. */
export const purgeVersions = async (projectId) => {
  const versions = await ProjectVersion.find({ codeProject: projectId }).select(
    "storedName isOriginal"
  );

  // The original archive is removed by the project delete itself, which owns it
  versions.filter((v) => !v.isOriginal).forEach((v) => removeStoredFile(v.storedName));

  await ProjectVersion.deleteMany({ codeProject: projectId });
};
