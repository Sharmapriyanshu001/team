import CodeSubmission from "../models/CodeSubmission.js";
import Project from "../models/Project.js";
import Task from "../models/Task.js";
import User, { ADMIN_ROLES } from "../models/User.js";
import { logActivity } from "../utils/activity.js";
import { notifyUser, notifyUsers } from "../utils/notify.js";

/**
 * Code sharing. One controller serves all three panels because the rules are
 * the same everywhere — only who is asking changes:
 *
 *   employee  submits code and reads what was shared with them
 *   leader    reviews what their own team sent them, and reads what the
 *             admin explicitly shared on top of that
 *   admin     sees everything, has the final say, and hands approved code out
 *
 * The leader's review queue is the one thing here that is not driven by the
 * share list: a submission is routed to a named reviewer when it is filed,
 * and that person may read it — including versions nobody has approved yet,
 * which is the entire point of a review.
 *
 * Nothing here trusts the panel the request came through: every read of a
 * submission goes past accessFor(), and the response is trimmed to what that
 * viewer is allowed to see.
 */

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A submission is a database row, not a file store — keep it that way.
const MAX_CODE_CHARS = 100000;
const MAX_VERSIONS = 50;
const MAX_ACCESS_LOG = 200;

const LIST_POPULATE = [
  { path: "submittedBy", select: "name email designation role" },
  { path: "project", select: "name code" },
  { path: "task", select: "title status priority dueDate" },
  { path: "reviewer", select: "name email role designation" },
  { path: "reviewedBy", select: "name role" },
];

const DETAIL_POPULATE = [
  ...LIST_POPULATE,
  { path: "sharedWith.user", select: "name email role designation" },
  { path: "sharedWith.sharedBy", select: "name" },
  { path: "versions.createdBy", select: "name" },
  { path: "accessLog.user", select: "name role" },
];

const withRefs = (query, populate = LIST_POPULATE) =>
  populate.reduce((q, p) => q.populate(p), query);

/** Whichever panel authenticated the request. */
const actorOf = (req) => req.admin || req.leader || req.employee;

const paginate = (req) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
};

const idOf = (value) => String(value?._id || value || "");

/* ------------------------------------------------------------- permissions */

/**
 * The single gate every read goes through. Returns null when the viewer has no
 * business seeing this submission at all.
 *
 *   admin    — full record, including the access trail
 *   owner    — their own submission, every version, who it went to
 *   reviewer — the team leader it is waiting on: every version, so they can
 *              actually review it, but not the distribution list or the trail
 *   shared   — approved versions only, and download only if that was granted
 */
export const accessFor = (doc, user) => {
  if (!doc || !user) return null;

  if (ADMIN_ROLES.includes(user.role)) return { level: "admin", canDownload: true };
  if (idOf(doc.submittedBy) === idOf(user._id)) return { level: "owner", canDownload: true };

  // Asked before the share list, so a reviewer who was also shared the code
  // gets the wider of the two rather than whichever test happened to run first
  if (idOf(doc.reviewer) === idOf(user._id)) {
    return { level: "reviewer", canDownload: true };
  }

  const share = (doc.sharedWith || []).find((row) => idOf(row.user) === idOf(user._id));
  if (share) return { level: "shared", canDownload: share.canDownload !== false };

  return null;
};

/**
 * Versions this viewer may read. A shared user never sees unapproved work —
 * but a reviewer must, because unapproved is exactly what they are being
 * asked to look at.
 */
const FULL_HISTORY = ["admin", "owner", "reviewer"];

const visibleVersions = (item, level) =>
  FULL_HISTORY.includes(level)
    ? item.versions || []
    : (item.versions || []).filter((v) => v.version <= (item.approvedVersion || 0));

/** List row: metadata only, so browsing a list never ships the source. */
const summarize = (doc, level) => {
  const item = doc.toObject ? doc.toObject() : doc;
  const versions = visibleVersions(item, level);

  return {
    ...item,
    versions: versions.map(({ code, ...rest }) => ({ ...rest, size: (code || "").length })),
    versionCount: versions.length,
    latestVersion: versions.length ? versions[versions.length - 1].version : 0,
    shareCount: (item.sharedWith || []).length,
    // Distribution list and audit trail are not a viewer's business
    sharedWith: level === "admin" || level === "owner" ? item.sharedWith : undefined,
    accessLog: undefined,
    myAccess: level,
  };
};

/** Detail record, with the source of every version the viewer may read. */
const present = (doc, level) => {
  const item = doc.toObject ? doc.toObject() : doc;

  return {
    ...item,
    versions: visibleVersions(item, level),
    shareCount: (item.sharedWith || []).length,
    sharedWith: level === "admin" || level === "owner" ? item.sharedWith : undefined,
    accessLog: level === "admin" ? item.accessLog : undefined,
    myAccess: level,
  };
};

/**
 * Append to the trail. Fire-and-forget, capped, and never allowed to break the
 * request it is recording — same contract as logActivity/notifyUser.
 */
const recordAccess = (submissionId, user, action, detail = "") => {
  CodeSubmission.updateOne(
    { _id: submissionId },
    {
      $push: {
        accessLog: {
          $each: [{ user: user?._id, userName: user?.name || "System", action, detail }],
          $slice: -MAX_ACCESS_LOG,
        },
      },
    }
  ).catch((err) => console.error("recordAccess error:", err.message));
};

/** Loads a submission and checks the viewer against it in one step. */
const loadFor = async (req, id, { detail = true } = {}) => {
  const doc = await withRefs(
    CodeSubmission.findById(id),
    detail ? DETAIL_POPULATE : LIST_POPULATE
  );
  if (!doc) return { error: { status: 404, message: "Code submission not found" } };

  const access = accessFor(doc, actorOf(req));
  if (!access) {
    return { error: { status: 403, message: "This code has not been shared with you" } };
  }

  return { doc, access };
};

const validateSource = ({ code, repoUrl }) => {
  const text = typeof code === "string" ? code : "";
  const url = (repoUrl || "").trim();

  if (!text.trim() && !url) {
    return { error: "Paste the code or link the repository" };
  }
  if (text.length > MAX_CODE_CHARS) {
    return { error: `Code is too large — keep it under ${MAX_CODE_CHARS / 1000}k characters` };
  }
  return { code: text, repoUrl: url };
};

/* ------------------------------------------------------------- the reviewer */

/**
 * Who a submission goes to.
 *
 * The project's team leader, or failing that whoever the employee reports to.
 * Null only when neither exists, and the caller falls back to the admins —
 * a submission that reaches nobody is worse than one that reaches the wrong
 * desk, because nothing tells anyone it happened.
 */
const resolveReviewer = async (employee, projectId) => {
  if (projectId) {
    const project = await Project.findById(projectId).select("teamLeader");
    if (project?.teamLeader) return project.teamLeader;
  }
  return employee.reportsTo || null;
};

/**
 * Tell whoever has to look at it. Falls back to every admin when the employee
 * has no team leader at all, so the queue is never a dead end.
 */
const alertReviewer = async (reviewer, { title, message }) => {
  if (reviewer) {
    notifyUser(reviewer, { type: "review", title, message, link: "/team-leader/code-reviews" });
    return;
  }

  const admins = await User.find({ role: { $in: ADMIN_ROLES } }).distinct("_id");
  notifyUsers(admins, { type: "review", title, message, link: "/admin/code" });
};

/* ------------------------------------------------------- employee: submit */

// POST /api/employee/code
export const submitCode = async (req, res) => {
  try {
    const { title, description, language, project, note } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: "Give the submission a title" });
    }

    const source = validateSource(req.body);
    if (source.error) return res.status(400).json({ message: source.error });

    // A submission may only be filed against a project the employee is on
    if (project) {
      const onProject = await Project.exists({ _id: project, members: req.employee._id });
      if (!onProject) return res.status(400).json({ message: "Pick one of your own projects" });
    }

    // And only against a task that is actually theirs, or approving it later
    // would close somebody else's work
    const { task } = req.body;
    if (task) {
      const ownTask = await Task.exists({ _id: task, assignedTo: req.employee._id });
      if (!ownTask) return res.status(400).json({ message: "Pick one of your own tasks" });
    }

    const reviewer = await resolveReviewer(req.employee, project);

    const created = await CodeSubmission.create({
      title: title.trim(),
      description: (description || "").trim(),
      language: (language || "other").trim(),
      project: project || undefined,
      task: task || undefined,
      submittedBy: req.employee._id,
      reviewer: reviewer || undefined,
      status: "pending",
      versions: [
        {
          version: 1,
          code: source.code,
          repoUrl: source.repoUrl,
          note: (note || "").trim(),
          createdBy: req.employee._id,
        },
      ],
      accessLog: [
        { user: req.employee._id, userName: req.employee.name, action: "submitted", detail: "v1" },
      ],
    });

    logActivity(req, {
      action: "created",
      entity: "Code Submission",
      entityId: created._id,
      message: `${req.employee.name} submitted code "${created.title}" for review`,
    });

    await alertReviewer(reviewer, {
      title: "Code submitted for review",
      message: `${req.employee.name} submitted "${created.title}"`,
    });

    const doc = await withRefs(CodeSubmission.findById(created._id));
    return res.status(201).json({
      message: reviewer
        ? "Code sent to your team leader for review"
        : "Code sent to the admin for review",
      item: summarize(doc, "owner"),
    });
  } catch (err) {
    console.error("submitCode error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/employee/code/:id/versions
export const addVersion = async (req, res) => {
  try {
    const doc = await CodeSubmission.findOne({
      _id: req.params.id,
      submittedBy: req.employee._id,
    });
    if (!doc) return res.status(404).json({ message: "Code submission not found" });

    const source = validateSource(req.body);
    if (source.error) return res.status(400).json({ message: source.error });

    if (doc.versions.length >= MAX_VERSIONS) {
      return res
        .status(400)
        .json({ message: `This submission already has ${MAX_VERSIONS} versions — start a new one` });
    }

    const version = (doc.versions[doc.versions.length - 1]?.version || 0) + 1;

    doc.versions.push({
      version,
      code: source.code,
      repoUrl: source.repoUrl,
      note: (req.body.note || "").trim(),
      createdBy: req.employee._id,
    });

    // A fresh version needs its own sign-off. Anything already approved stays
    // approved, so people it was shared with keep the version they were given.
    doc.status = "pending";
    doc.reviewNote = "";

    /**
     * Re-resolved rather than left alone: between the first submission and
     * this one the project may have been handed to a different team leader,
     * and a resubmission belongs in the queue of whoever leads it now.
     */
    const reviewer = await resolveReviewer(req.employee, doc.project);
    doc.reviewer = reviewer || undefined;
    doc.accessLog.push({
      user: req.employee._id,
      userName: req.employee.name,
      action: "version_added",
      detail: `v${version}`,
    });

    await doc.save();

    logActivity(req, {
      action: "updated",
      entity: "Code Submission",
      entityId: doc._id,
      message: `${req.employee.name} added v${version} to "${doc.title}"`,
    });

    await alertReviewer(reviewer, {
      title: "New code version to review",
      message: `${req.employee.name} pushed v${version} of "${doc.title}"`,
    });

    const fresh = await withRefs(CodeSubmission.findById(doc._id), DETAIL_POPULATE);
    return res.status(200).json({ message: `Version ${version} sent for review`, item: present(fresh, "owner") });
  } catch (err) {
    console.error("addVersion error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/employee/code — the employee's own submissions
export const listMySubmissions = async (req, res) => {
  try {
    const query = { submittedBy: req.employee._id };

    if (req.query.status && req.query.status !== "all") query.status = req.query.status;
    if (req.query.project && req.query.project !== "all") query.project = req.query.project;

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [{ title: regex }, { description: regex }];
    }

    const { page, limit, skip } = paginate(req);

    const [docs, total] = await Promise.all([
      withRefs(CodeSubmission.find(query)).sort({ createdAt: -1 }).skip(skip).limit(limit),
      CodeSubmission.countDocuments(query),
    ]);

    return res.status(200).json({
      items: docs.map((doc) => summarize(doc, "owner")),
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error("listMySubmissions error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------- shared with me (all) */

/**
 * GET /api/employee/code/shared  ·  GET /api/leader/code
 *
 * Driven purely by the sharedWith list, so a team leader sees exactly what the
 * admin handed them — never their team's submissions by default.
 */
export const listSharedWithMe = async (req, res) => {
  try {
    const user = actorOf(req);
    const query = { "sharedWith.user": user._id, approvedVersion: { $gt: 0 } };

    if (req.query.language && req.query.language !== "all") query.language = req.query.language;
    if (req.query.project && req.query.project !== "all") query.project = req.query.project;

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [{ title: regex }, { description: regex }];
    }

    const { page, limit, skip } = paginate(req);

    const [docs, total] = await Promise.all([
      withRefs(CodeSubmission.find(query)).sort({ updatedAt: -1 }).skip(skip).limit(limit),
      CodeSubmission.countDocuments(query),
    ]);

    const items = docs.map((doc) => {
      const access = accessFor(doc, user);
      return { ...summarize(doc, access.level), canDownload: access.canDownload };
    });

    return res.status(200).json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error("listSharedWithMe error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------- read one · any panel */

// GET /api/{admin|leader|employee}/code/:id
export const getSubmission = async (req, res) => {
  try {
    const { doc, access, error } = await loadFor(req, req.params.id);
    if (error) return res.status(error.status).json({ message: error.message });

    // Only an outside reader is worth a trail entry — the author and the admin
    // opening their own screens would drown it.
    if (access.level === "shared") {
      recordAccess(doc._id, actorOf(req), "viewed", `v${doc.approvedVersion}`);
    }

    return res.status(200).json({ item: present(doc, access.level), canDownload: access.canDownload });
  } catch (err) {
    console.error("getSubmission error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

const EXTENSIONS = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  java: "java",
  php: "php",
  html: "html",
  css: "css",
  sql: "sql",
  json: "json",
  other: "txt",
};

// GET /api/{admin|leader|employee}/code/:id/download?version=2
export const downloadSubmission = async (req, res) => {
  try {
    const { doc, access, error } = await loadFor(req, req.params.id, { detail: false });
    if (error) return res.status(error.status).json({ message: error.message });

    if (!access.canDownload) {
      return res.status(403).json({ message: "You may view this code but not download it" });
    }

    const allowed = visibleVersions(doc.toObject(), access.level);
    if (!allowed.length) {
      return res.status(404).json({ message: "No approved version to download yet" });
    }

    const wanted = parseInt(req.query.version, 10);
    const version = wanted
      ? allowed.find((v) => v.version === wanted)
      : allowed[allowed.length - 1];

    if (!version) return res.status(404).json({ message: "That version is not available to you" });
    if (!version.code) {
      return res.status(400).json({ message: "This version is a repository link, not a file" });
    }

    recordAccess(doc._id, actorOf(req), "downloaded", `v${version.version}`);

    const slug = doc.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "code";
    const filename = `${slug}-v${version.version}.${EXTENSIONS[doc.language] || "txt"}`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(version.code);
  } catch (err) {
    console.error("downloadSubmission error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------------ admin */

// GET /api/admin/code
export const adminListSubmissions = async (req, res) => {
  try {
    const query = {};

    if (req.query.status && req.query.status !== "all") query.status = req.query.status;
    if (req.query.submittedBy && req.query.submittedBy !== "all") {
      query.submittedBy = req.query.submittedBy;
    }
    if (req.query.project && req.query.project !== "all") query.project = req.query.project;
    if (req.query.view === "shared") query.sharedWith = { $ne: [] };
    if (req.query.view === "unshared") query.sharedWith = { $eq: [] };

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [{ title: regex }, { description: regex }];
    }

    const { page, limit, skip } = paginate(req);

    const [docs, total, pending] = await Promise.all([
      withRefs(CodeSubmission.find(query)).sort({ createdAt: -1 }).skip(skip).limit(limit),
      CodeSubmission.countDocuments(query),
      CodeSubmission.countDocuments({ status: "pending" }),
    ]);

    return res.status(200).json({
      items: docs.map((doc) => summarize(doc, "admin")),
      total,
      pending,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error("adminListSubmissions error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/admin/code/:id/review  { decision: approve | reject, note }
export const reviewSubmission = async (req, res) => {
  try {
    const doc = await CodeSubmission.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Code submission not found" });

    const { decision, note } = req.body;
    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({ message: "Decision must be approve or reject" });
    }

    const latest = doc.versions[doc.versions.length - 1];
    if (!latest) return res.status(400).json({ message: "There is nothing to review" });

    if (decision === "approve") {
      doc.status = "approved";
      doc.approvedVersion = latest.version;
    } else {
      // Rejecting only stops the new version. Whatever was approved before is
      // still out there with the people it was shared with.
      doc.status = "rejected";
    }

    doc.reviewedBy = req.admin._id;
    // Which chair the decision was made from — a leader's review and an
    // admin's override read differently on the employee's screen
    doc.reviewedByRole = req.admin.role;
    doc.reviewedAt = new Date();
    doc.reviewNote = (note || "").trim();
    doc.accessLog.push({
      user: req.admin._id,
      userName: req.admin.name,
      action: decision === "approve" ? "approved" : "rejected",
      detail: `v${latest.version}`,
    });

    await doc.save();

    logActivity(req, {
      action: "updated",
      entity: "Code Submission",
      entityId: doc._id,
      message: `${req.admin.name} ${decision === "approve" ? "approved" : "rejected"} "${doc.title}" v${latest.version}`,
    });

    notifyUser(doc.submittedBy, {
      type: "review",
      title: decision === "approve" ? "Code approved" : "Code rejected",
      message: `"${doc.title}" v${latest.version}${doc.reviewNote ? ` — ${doc.reviewNote}` : ""}`,
      link: "/employee/code",
    });

    const fresh = await withRefs(CodeSubmission.findById(doc._id), DETAIL_POPULATE);
    return res.status(200).json({ message: `Code ${decision === "approve" ? "approved" : "rejected"}`, item: present(fresh, "admin") });
  } catch (err) {
    console.error("reviewSubmission error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------- team leader: review queue */

/**
 * GET /api/leader/code/review?status=pending|approved|changes_required|all
 *
 * What this leader's team has sent them to look at.
 *
 * Scoped on `reviewer`, not on the projects they lead: a submission is routed
 * to one person when it is filed, and that is who it waits on. Leading a
 * project the code happens to belong to grants nothing here on its own, which
 * keeps this consistent with how every other list in this controller works.
 */
export const listReviewQueue = async (req, res) => {
  try {
    const query = { reviewer: req.leader._id };

    const status = req.query.status || "pending";
    if (status !== "all") query.status = status;

    if (req.query.project && req.query.project !== "all") query.project = req.query.project;

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [{ title: regex }, { description: regex }];
    }

    const { page, limit, skip } = paginate(req);

    const [docs, total, waiting] = await Promise.all([
      withRefs(CodeSubmission.find(query)).sort({ createdAt: -1 }).skip(skip).limit(limit),
      CodeSubmission.countDocuments(query),
      // Rides along so the panel can badge the queue without a second call
      CodeSubmission.countDocuments({ reviewer: req.leader._id, status: "pending" }),
    ]);

    return res.status(200).json({
      items: docs.map((doc) => summarize(doc, "reviewer")),
      total,
      waiting,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error("listReviewQueue error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * PUT /api/leader/code/:id/review   { decision: "approve" | "changes", note }
 *
 * The team leader's decision on a submission.
 *
 * Deliberately not the same handler as the admin's: this one refuses anything
 * that is not in this leader's own queue, and it cannot reject — a leader
 * either signs work off or sends it back with a comment. Refusing outright
 * stays the admin's, because it is the admin who owns the project.
 */
export const reviewAsLeader = async (req, res) => {
  try {
    const doc = await CodeSubmission.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Code submission not found" });

    // Being a team leader is not the check; being *this* submission's reviewer is
    if (idOf(doc.reviewer) !== idOf(req.leader._id)) {
      return res.status(403).json({ message: "This submission is not in your review queue" });
    }

    const decision = String(req.body.decision || "").trim();
    if (!["approve", "changes"].includes(decision)) {
      return res.status(400).json({ message: "Decision must be approve or changes" });
    }

    const note = String(req.body.note || "").trim();

    /**
     * Sending work back without saying why is how a review loop turns into a
     * guessing game, so the comment is required in that direction only.
     */
    if (decision === "changes" && !note) {
      return res.status(400).json({ message: "Say what needs changing — they cannot act on a bare rejection" });
    }

    const latest = doc.versions[doc.versions.length - 1];
    if (!latest) return res.status(400).json({ message: "There is nothing to review" });

    if (doc.status !== "pending") {
      return res.status(409).json({
        message: `This submission is already marked ${doc.status.replace(/_/g, " ")}`,
      });
    }

    if (decision === "approve") {
      doc.status = "approved";
      doc.approvedVersion = latest.version;
    } else {
      // Nothing already approved is pulled back — only the new version stops
      doc.status = "changes_required";
    }

    doc.reviewedBy = req.leader._id;
    doc.reviewedByRole = "team_leader";
    doc.reviewedAt = new Date();
    doc.reviewNote = note;
    doc.accessLog.push({
      user: req.leader._id,
      userName: req.leader.name,
      action: decision === "approve" ? "approved" : "changes_requested",
      detail: `v${latest.version}`,
    });

    await doc.save();

    /**
     * The task the work was done for, if there was one. This is the join
     * between the two review flows the app already had — approving the code is
     * what closes the task, and asking for changes is what reopens it.
     *
     * Guarded on the task still being the submitter's, so a submission cannot
     * be used to close somebody else's work.
     */
    let taskNote = "";
    if (doc.task) {
      const task = await Task.findOne({ _id: doc.task, assignedTo: doc.submittedBy });
      if (task) {
        task.status = decision === "approve" ? "completed" : "in_progress";
        if (note) task.reviewNote = note;
        await task.save();
        taskNote = decision === "approve" ? ` — "${task.title}" marked complete` : "";
      }
    }

    logActivity(req, {
      action: "updated",
      entity: "Code Submission",
      entityId: doc._id,
      message: `${req.leader.name} ${
        decision === "approve" ? "approved" : "requested changes on"
      } "${doc.title}" v${latest.version}`,
    });

    notifyUser(doc.submittedBy, {
      type: "review",
      title: decision === "approve" ? "Code approved" : "Changes requested",
      message: `"${doc.title}" v${latest.version}${note ? ` — ${note}` : ""}`,
      link: "/employee/code",
    });

    const fresh = await withRefs(CodeSubmission.findById(doc._id), DETAIL_POPULATE);
    return res.status(200).json({
      message:
        decision === "approve"
          ? `Approved${taskNote}`
          : "Sent back with your comments",
      item: present(fresh, "reviewer"),
    });
  } catch (err) {
    console.error("reviewAsLeader error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};


/**
 * Turns a group choice into the actual people it means. Groups are a shortcut
 * in the form only — what gets stored is always an explicit list of users, so
 * the permission check stays a simple membership test.
 */
const expandGroup = async (group, doc) => {
  if (group === "all_employees") {
    return User.find({ role: "employee", status: "active" }).distinct("_id");
  }
  if (group === "all_team_leaders") {
    return User.find({ role: "team_leader", status: "active" }).distinct("_id");
  }
  if (group === "project_team") {
    if (!doc.project) return [];
    const project = await Project.findById(doc.project).select("members teamLeader");
    if (!project) return [];
    return [...(project.members || []), project.teamLeader].filter(Boolean);
  }
  return [];
};

// POST /api/admin/code/:id/share  { users: [], group, canDownload, note }
export const shareSubmission = async (req, res) => {
  try {
    const doc = await CodeSubmission.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Code submission not found" });

    // Only reviewed code leaves the admin's desk
    if (!doc.approvedVersion) {
      return res.status(400).json({ message: "Approve the code before sharing it" });
    }

    const { group, canDownload = true, note } = req.body;
    const picked = Array.isArray(req.body.users) ? req.body.users : [];
    const fromGroup = group ? await expandGroup(group, doc) : [];

    const wanted = [...new Set([...picked, ...fromGroup].map(String))].filter(Boolean);
    if (!wanted.length) {
      return res.status(400).json({ message: "Pick at least one person to share with" });
    }

    // Only real, active staff — and never the author, who already has it
    const targets = await User.find({
      _id: { $in: wanted, $ne: doc.submittedBy },
      role: { $in: ["team_leader", "employee"] },
      status: "active",
    }).select("name role");

    if (!targets.length) {
      return res.status(400).json({ message: "None of those accounts can receive shared code" });
    }

    const added = [];
    targets.forEach((target) => {
      const existing = doc.sharedWith.find((row) => idOf(row.user) === idOf(target._id));

      if (existing) {
        // Re-sharing is how the admin flips download access on or off
        existing.canDownload = canDownload !== false;
        if (note !== undefined) existing.note = (note || "").trim();
        return;
      }

      doc.sharedWith.push({
        user: target._id,
        canDownload: canDownload !== false,
        note: (note || "").trim(),
        sharedBy: req.admin._id,
      });
      added.push(target);
    });

    doc.accessLog.push({
      user: req.admin._id,
      userName: req.admin.name,
      action: "shared",
      detail: `${targets.length} user${targets.length === 1 ? "" : "s"}${group ? ` · ${group.replace(/_/g, " ")}` : ""}`,
    });

    await doc.save();

    logActivity(req, {
      action: "updated",
      entity: "Code Submission",
      entityId: doc._id,
      message: `${req.admin.name} shared "${doc.title}" with ${targets.length} user${targets.length === 1 ? "" : "s"}`,
    });

    added.forEach((target) => {
      notifyUser(target._id, {
        type: "system",
        title: "Code shared with you",
        message: `"${doc.title}" v${doc.approvedVersion}`,
        link: target.role === "team_leader" ? "/team-leader/code" : "/employee/code/shared",
      });
    });

    const fresh = await withRefs(CodeSubmission.findById(doc._id), DETAIL_POPULATE);
    return res.status(200).json({
      message: `Shared with ${targets.length} user${targets.length === 1 ? "" : "s"}`,
      item: present(fresh, "admin"),
    });
  } catch (err) {
    console.error("shareSubmission error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// DELETE /api/admin/code/:id/share/:userId
export const revokeShare = async (req, res) => {
  try {
    const doc = await CodeSubmission.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Code submission not found" });

    const row = doc.sharedWith.find((entry) => idOf(entry.user) === String(req.params.userId));
    if (!row) return res.status(404).json({ message: "That person does not have access" });

    doc.sharedWith.pull(row._id);
    doc.accessLog.push({
      user: req.admin._id,
      userName: req.admin.name,
      action: "revoked",
      detail: String(req.params.userId),
    });

    await doc.save();

    logActivity(req, {
      action: "updated",
      entity: "Code Submission",
      entityId: doc._id,
      message: `${req.admin.name} revoked access to "${doc.title}"`,
    });

    const fresh = await withRefs(CodeSubmission.findById(doc._id), DETAIL_POPULATE);
    return res.status(200).json({ message: "Access revoked", item: present(fresh, "admin") });
  } catch (err) {
    console.error("revokeShare error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
