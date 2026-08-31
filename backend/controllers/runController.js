import CodeProject from "../models/CodeProject.js";
import { logActivity } from "../utils/activity.js";
import { accessFor, binnedError } from "./codeProjectController.js";
import {
  closeSession,
  listSessions,
  logsSince,
  npmAvailable,
  openSession,
  scriptsOf,
  sendInput,
  start,
  statusOf,
  stop,
} from "../utils/runner.js";

/**
 * The workspace terminal.
 *
 * Every one of these needs canRun, which is the same permission the preview
 * uses — being able to see a project run and being able to start it are the
 * same decision, and splitting them would only invite one to be granted
 * without the other by accident.
 *
 * A session id names which terminal tab is meant. Left out, the first one is
 * used, which is what a single-tab caller wants.
 */

const actorOf = (req) => req.admin || req.leader || req.employee;

const gate = async (req) => {
  const user = actorOf(req);

  const project = await CodeProject.findById(req.params.id);
  // Same answer for missing and not-yours, as everywhere else
  if (!project) return { error: { status: 404, message: "Code project not found" } };

  const access = accessFor(project, user);
  if (!access) return { error: { status: 404, message: "Code project not found" } };

  const binned = binnedError(access);
  if (binned) return { error: binned };

  if (!access.canRun) {
    return { error: { status: 403, message: "You do not have permission to run this project" } };
  }

  return { project, access, user };
};

/** The session id from a query or a body, as a string or nothing at all. */
const sessionFrom = (req) => {
  const raw = req.query?.session ?? req.body?.session;
  return typeof raw === "string" && raw ? raw : undefined;
};

/* ------------------------------------------------------------------ status */

// GET /api/{...}/workspace/:id/run
export const getRunStatus = async (req, res) => {
  try {
    const { project, error } = await gate(req);
    if (error) return res.status(error.status).json({ message: error.message });

    const { sessions, root } = listSessions(project);

    return res.status(200).json({
      sessions,
      root,
      // The scripts of the folder this tab is standing in, so the buttons
      // offer what would actually run from here
      scripts: scriptsOf(project, sessionFrom(req)),
      rootDir: project.rootDir || "",
      stack: project.stack,
      npmAvailable: npmAvailable(),
      // What a single-tab caller reads
      status: statusOf(project, sessionFrom(req)),
    });
  } catch (err) {
    console.error("getRunStatus error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------------- sessions */

// POST /api/{...}/workspace/:id/run/session   { name }
export const createSession = async (req, res) => {
  try {
    const { project, error } = await gate(req);
    if (error) return res.status(error.status).json({ message: error.message });

    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const result = openSession(project, name);
    if (result.error) return res.status(400).json({ message: result.error });

    return res.status(201).json({ message: "Terminal opened", session: result.session });
  } catch (err) {
    console.error("createSession error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// DELETE /api/{...}/workspace/:id/run/session/:session
export const removeSession = async (req, res) => {
  try {
    const { project, error } = await gate(req);
    if (error) return res.status(error.status).json({ message: error.message });

    const result = await closeSession(project, req.params.session);

    return res.status(200).json({
      message: result.closed ? "Terminal closed" : "That terminal was already gone",
      ...listSessions(project),
    });
  } catch (err) {
    console.error("removeSession error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------------- logs */

// GET /api/{...}/workspace/:id/run/logs?session=…&since=42
export const getRunLogs = async (req, res) => {
  try {
    const { project, error } = await gate(req);
    if (error) return res.status(error.status).json({ message: error.message });

    return res.status(200).json(logsSince(project, sessionFrom(req), req.query.since));
  } catch (err) {
    console.error("getRunLogs error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------------- start */

// POST /api/{...}/workspace/:id/run   { command, session }
export const startRun = async (req, res) => {
  try {
    const { project, user, error } = await gate(req);
    if (error) return res.status(error.status).json({ message: error.message });

    /**
     * The command must arrive as text. String() would turn ["dev"] into "dev"
     * and {} into "[object Object]", and matching a caller's shape by
     * coercion is not the same as being sent the thing.
     */
    const { command } = req.body || {};
    if (typeof command !== "string") {
      return res.status(400).json({ message: "The command must be text" });
    }

    const result = await start(
      project,
      { command, sessionId: sessionFrom(req) },
      user.name
    );
    if (result.error) return res.status(400).json({ message: result.error });

    // Starting a process on the server is worth a line in the trail
    logActivity(req, {
      action: "updated",
      entity: "Code Project",
      entityId: project._id,
      message: `${user.name} ran "${command.slice(0, 120)}" on "${project.name}"`,
    });

    project.runStatus = "running";
    await project.save();

    return res.status(200).json({ message: `Started ${command}`, status: result.session });
  } catch (err) {
    console.error("startRun error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------------- stop */

// DELETE /api/{...}/workspace/:id/run?session=…
export const stopRun = async (req, res) => {
  try {
    const { project, user, error } = await gate(req);
    if (error) return res.status(error.status).json({ message: error.message });

    const session = sessionFrom(req);
    const result = await stop(project._id, session);

    if (result.stopped) {
      logActivity(req, {
        action: "updated",
        entity: "Code Project",
        entityId: project._id,
        message: `${user.name} stopped a process on "${project.name}"`,
      });
    }

    // Only quiet the project's own flag when nothing at all is left running
    const { sessions } = listSessions(project);
    if (!sessions.some((s) => s.status === "running")) {
      project.runStatus = "stopped";
      await project.save();
    }

    return res.status(200).json({
      message: result.stopped ? "Stopped" : "Nothing was running",
      status: statusOf(project, session),
    });
  } catch (err) {
    console.error("stopRun error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------------- input */

// POST /api/{...}/workspace/:id/run/input   { text, session }
export const sendRunInput = async (req, res) => {
  try {
    const { project, error } = await gate(req);
    if (error) return res.status(error.status).json({ message: error.message });

    if (typeof req.body?.text !== "string") {
      return res.status(400).json({ message: "Send the text to type" });
    }

    const result = sendInput(project, sessionFrom(req), req.body.text);
    if (!result.sent) return res.status(400).json({ message: result.error });

    return res.status(200).json({ message: "Sent", status: statusOf(project, sessionFrom(req)) });
  } catch (err) {
    console.error("sendRunInput error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
