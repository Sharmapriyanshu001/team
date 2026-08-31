import fs from "fs";

import CodePackage from "../models/CodePackage.js";
import User, { ADMIN_ROLES } from "../models/User.js";
import { logActivity } from "../utils/activity.js";
import { notifyUser } from "../utils/notify.js";
import { removeStoredFile, storedPath } from "../utils/uploads.js";

/**
 * Sending a code archive to colleagues. One controller serves all three panels
 * because the rules do not change with the door you came in through — only who
 * is asking does, and every handler resolves that the same way.
 *
 * Access is deliberately narrow: a package is readable by the person who sent
 * it and by the people named on it. Nothing else, no admin override, so an
 * archive cannot be pulled by URL from a panel that was never given it.
 */

const idOf = (value) => String(value?._id || value || "");

/** Whichever panel authenticated the request. */
const actorOf = (req) => req.admin || req.leader || req.employee;

// Everyone who can hold a staff login, which is everyone who can be sent to.
const STAFF_ROLES = [...ADMIN_ROLES, "team_leader", "employee"];

// The new Code section, which is a different screen from the review pipeline
// each panel already had at /code.
const panelOf = (role) => {
  if (ADMIN_ROLES.includes(role)) return "/admin/code-share";
  return role === "team_leader" ? "/team-leader/code-share" : "/employee/code-share";
};

const paginate = (req) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The recipient list survives multipart as a JSON string, JSON as an array. */
const parseRecipients = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** What a list row shows. The stored name never leaves the server. */
const summarize = (doc, me) => {
  const item = doc.toObject ? doc.toObject() : doc;
  const mine = item.recipients.find((row) => idOf(row.user) === idOf(me));

  return {
    _id: item._id,
    title: item.title,
    note: item.note,
    originalName: item.originalName,
    size: item.size,
    sentBy: item.sentBy,
    sentByName: item.sentByName,
    sentByRole: item.sentByRole,
    createdAt: item.createdAt,

    recipients: item.recipients,
    recipientCount: item.recipients.length,
    downloadedCount: item.recipients.filter((row) => row.downloadedAt).length,

    // Only meaningful on the received list — this is the viewer's own row
    myDownloadedAt: mine?.downloadedAt || null,
  };
};

/* --------------------------------------------------------------- send it */

// POST /api/{admin|leader|employee}/code-share   (multipart; "file" is the zip)
export const sendPackage = async (req, res) => {
  const discard = () => req.file && removeStoredFile(req.file.filename);

  try {
    const me = actorOf(req);

    if (!req.file) {
      return res.status(400).json({ message: "Attach a .zip file to send" });
    }

    const title = (req.body.title || "").trim() || req.file.originalname;

    /* ------------------------------------------------------------- people */

    const wanted = [
      ...new Set(
        parseRecipients(req.body.recipients)
          .map((entry) => String(entry?.id || entry?._id || entry || ""))
          .filter(Boolean)
      ),
    ];

    if (!wanted.length) {
      discard();
      return res.status(400).json({ message: "Pick at least one person to send this to" });
    }

    // Sending to yourself is a no-op, so it is filtered out rather than refused
    const targets = await User.find({
      _id: { $in: wanted, $ne: me._id },
      role: { $in: STAFF_ROLES },
      status: "active",
    }).select("name role");

    if (!targets.length) {
      discard();
      return res.status(400).json({
        message: "None of those accounts can receive code — pick an active team member",
      });
    }

    /* --------------------------------------------------------------- store */

    const created = await CodePackage.create({
      title,
      note: (req.body.note || "").trim(),
      storedName: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      sentBy: me._id,
      sentByName: me.name,
      sentByRole: me.role,
      recipients: targets.map((person) => ({
        user: person._id,
        name: person.name,
        role: person.role,
      })),
    });

    logActivity(req, {
      action: "created",
      entity: "Code Package",
      entityId: created._id,
      message: `${me.name} sent "${title}" to ${targets.map((t) => t.name).join(", ")}`,
    });

    targets.forEach((person) => {
      notifyUser(person._id, {
        type: "system",
        title: "Code sent to you",
        message: `${me.name} sent you "${title}"`,
        link: panelOf(person.role),
      });
    });

    return res.status(201).json({
      message: `Sent to ${targets.length} ${targets.length === 1 ? "person" : "people"}`,
      item: summarize(created, me._id),
    });
  } catch (err) {
    console.error("sendPackage error:", err);
    discard();
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------- the lists */

const listBy = (buildQuery) => async (req, res) => {
  try {
    const me = actorOf(req);
    const query = buildQuery(me);

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [{ title: regex }, { originalName: regex }, { note: regex }];
    }

    const { page, limit, skip } = paginate(req);

    const [docs, total] = await Promise.all([
      CodePackage.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      CodePackage.countDocuments(query),
    ]);

    return res.status(200).json({
      items: docs.map((doc) => summarize(doc, me._id)),
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error("code package list error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/{...}/code-share/sent  -> "who have I sent this to"
export const listSent = listBy((me) => ({ sentBy: me._id }));

// GET /api/{...}/code-share/received
export const listReceived = listBy((me) => ({ "recipients.user": me._id }));

/* ------------------------------------------------------------- who to send to */

// GET /api/{...}/code-share/people
export const listPeople = async (req, res) => {
  try {
    const me = actorOf(req);

    const people = await User.find({
      _id: { $ne: me._id },
      role: { $in: STAFF_ROLES },
      status: "active",
    })
      .select("name role designation")
      .sort({ name: 1 });

    return res.status(200).json({ people });
  } catch (err) {
    console.error("listPeople error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------------- download */

// GET /api/{...}/code-share/:id/download
export const downloadPackage = async (req, res) => {
  try {
    const me = actorOf(req);

    const doc = await CodePackage.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "That code package no longer exists" });

    const isSender = idOf(doc.sentBy) === idOf(me._id);
    const mine = doc.recipients.find((row) => idOf(row.user) === idOf(me._id));

    if (!isSender && !mine) {
      return res.status(403).json({ message: "This code was not sent to you" });
    }

    const target = storedPath(doc.storedName);
    if (!target) {
      return res.status(404).json({ message: "The archive is missing from the server" });
    }

    // The sender checking their own upload must not show up as a delivery
    if (mine) {
      mine.downloadedAt = new Date();
      mine.downloadCount = (mine.downloadCount || 0) + 1;
      await doc.save();
    }

    res.setHeader("Content-Type", doc.mimeType || "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(doc.originalName || `${doc.title}.zip`).replace(/"/g, "")}"`
    );

    const stream = fs.createReadStream(target);
    stream.on("error", (err) => {
      console.error("downloadPackage stream error:", err.message);
      if (!res.headersSent) res.status(500).json({ message: "Could not read the archive" });
    });
    return stream.pipe(res);
  } catch (err) {
    console.error("downloadPackage error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------------ withdraw */

// DELETE /api/{...}/code-share/:id  -> only the sender, and it goes for everyone
export const removePackage = async (req, res) => {
  try {
    const me = actorOf(req);

    const doc = await CodePackage.findOne({ _id: req.params.id, sentBy: me._id });
    if (!doc) {
      return res.status(404).json({ message: "Not found, or you were not the one who sent it" });
    }

    removeStoredFile(doc.storedName);
    await doc.deleteOne();

    logActivity(req, {
      action: "deleted",
      entity: "Code Package",
      entityId: doc._id,
      message: `${me.name} withdrew "${doc.title}"`,
    });

    return res.status(200).json({ message: `"${doc.title}" withdrawn` });
  } catch (err) {
    console.error("removePackage error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
