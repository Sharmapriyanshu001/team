import Credential from "../models/Credential.js";
import { seal, open, vaultProblem, vaultReady } from "../utils/secretBox.js";
import { logActivity } from "../utils/activity.js";

/**
 * The credential vault.
 *
 * Three rules hold the whole thing up, and every handler below exists to keep
 * one of them:
 *
 *   1. A secret is never in a list. Every response is built from doc.safe(),
 *      which cannot return the sealed fields even by accident.
 *   2. Reading one is a separate, deliberate request — and it is written down,
 *      in the credential's own access log and in the activity log.
 *   3. Without VAULT_KEY nothing here works, and it says so plainly rather
 *      than storing anything in the clear.
 */

/** Answered before anything else, so a misconfigured server says why. */
const guardVault = (res) => {
  if (vaultReady()) return false;
  res.status(503).json({ message: vaultProblem(), code: "VAULT_OFF" });
  return true;
};

const actorOf = (req) => req.admin || req.leader || req.employee;

const ACCESS_LOG_LIMIT = 50;

const noteAccess = (credential, req, action) => {
  const actor = actorOf(req);

  credential.accessLog.push({
    user: actor?._id,
    userName: actor?.name || "",
    userRole: actor?.role || "",
    at: new Date(),
    action,
  });

  // Keep the recent history, not all of it — see the model's comment
  if (credential.accessLog.length > ACCESS_LOG_LIMIT) {
    credential.accessLog = credential.accessLog.slice(-ACCESS_LOG_LIMIT);
  }
};

/* ------------------------------------------------------------------- admin */

export const listCredentials = async (req, res) => {
  if (guardVault(res)) return undefined;

  try {
    const query = {};
    if (req.query.type && req.query.type !== "all") query.type = req.query.type;
    if (req.query.client && req.query.client !== "all") query.client = req.query.client;
    if (req.query.status && req.query.status !== "all") query.status = req.query.status;

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ label: regex }, { username: regex }, { url: regex }];
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const [rows, total] = await Promise.all([
      Credential.find(query)
        .populate("client", "name company")
        .populate("sharedWith", "name email")
        .sort({ label: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Credential.countDocuments(query),
    ]);

    return res.status(200).json({
      items: rows.map((row) => row.safe()),
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error("listCredentials error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const createCredential = async (req, res) => {
  if (guardVault(res)) return undefined;

  try {
    const { secret, notes, ...rest } = req.body;

    const credential = new Credential({
      ...rest,
      client: rest.client || null,
      project: rest.project || null,
      secretSealed: secret ? seal(secret) : "",
      notesSealed: notes ? seal(notes) : "",
      createdBy: req.admin?._id,
    });

    noteAccess(credential, req, "created");
    await credential.save();

    logActivity(req, {
      action: "created",
      entity: "Credential",
      entityId: credential._id,
      message: `Vault entry "${credential.label}" created`,
    });

    return res.status(201).json({ message: "Saved to the vault", item: credential.safe() });
  } catch (err) {
    console.error("createCredential error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateCredential = async (req, res) => {
  if (guardVault(res)) return undefined;

  try {
    const credential = await Credential.findById(req.params.id);
    if (!credential) return res.status(404).json({ message: "Not found" });

    const { secret, notes, ...rest } = req.body;

    [
      "label",
      "type",
      "client",
      "project",
      "url",
      "username",
      "hint",
      "sharedWith",
      "expiresAt",
      "status",
    ].forEach((field) => {
      if (rest[field] !== undefined) credential[field] = rest[field] || null;
    });

    /**
     * An empty string means "leave it alone", not "erase it".
     *
     * The edit form cannot show the current secret, so it is always sent
     * blank unless somebody types a new one. Treating blank as a deletion
     * would quietly wipe the password every time anybody corrected a label.
     * Clearing is possible, but it has to be asked for by name.
     */
    if (secret) {
      credential.secretSealed = seal(secret);
      credential.lastRotatedAt = new Date();
      noteAccess(credential, req, "updated");
    } else if (rest.clearSecret === true) {
      credential.secretSealed = "";
    }

    if (notes) credential.notesSealed = seal(notes);
    else if (rest.clearNotes === true) credential.notesSealed = "";

    await credential.save();

    logActivity(req, {
      action: "updated",
      entity: "Credential",
      entityId: credential._id,
      message: `Vault entry "${credential.label}" updated${secret ? " (secret rotated)" : ""}`,
    });

    return res.status(200).json({ message: "Updated", item: credential.safe() });
  } catch (err) {
    console.error("updateCredential error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const removeCredential = async (req, res) => {
  if (guardVault(res)) return undefined;

  try {
    const credential = await Credential.findById(req.params.id);
    if (!credential) return res.status(404).json({ message: "Not found" });

    await credential.deleteOne();

    logActivity(req, {
      action: "deleted",
      entity: "Credential",
      entityId: credential._id,
      message: `Vault entry "${credential.label}" deleted`,
    });

    return res.status(200).json({ message: "Deleted from the vault" });
  } catch (err) {
    console.error("removeCredential error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Hand over the secret — the one handler that decrypts anything.
 *
 * A POST rather than a GET, deliberately. GETs are prefetched by browsers,
 * logged by proxies with their full URL, and sit in history; none of that
 * should be true of the act of reading a password. It also makes the access
 * log honest: a GET could be triggered by something other than a person
 * deciding to look.
 */
export const revealCredential = async (req, res) => {
  if (guardVault(res)) return undefined;

  try {
    const credential = await Credential.findById(req.params.id);
    if (!credential) return res.status(404).json({ message: "Not found" });

    const actor = actorOf(req);

    // Staff arrive here through their own routes; an admin is never restricted
    if (!req.admin) {
      const shared = (credential.sharedWith || []).some(
        (id) => String(id) === String(actor._id)
      );
      if (!shared) {
        return res.status(403).json({ message: "This credential has not been shared with you" });
      }
    }

    let secret = "";
    let notes = "";
    try {
      secret = open(credential.secretSealed);
      notes = open(credential.notesSealed);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }

    noteAccess(credential, req, "revealed");
    await credential.save();

    logActivity(req, {
      action: "viewed",
      entity: "Credential",
      entityId: credential._id,
      message: `${actor?.name || "Someone"} revealed "${credential.label}"`,
    });

    return res.status(200).json({ secret, notes, label: credential.label });
  } catch (err) {
    console.error("revealCredential error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** Who has been looking. Admin only — it is a record about people. */
export const credentialAccessLog = async (req, res) => {
  try {
    const credential = await Credential.findById(req.params.id).populate("accessLog.user", "name");
    if (!credential) return res.status(404).json({ message: "Not found" });

    return res.status(200).json({
      label: credential.label,
      accessLog: [...credential.accessLog].reverse(),
    });
  } catch (err) {
    console.error("credentialAccessLog error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------------- staff */

/** Only what has been shared with this person, and never the secrets. */
export const myCredentials = async (req, res) => {
  if (guardVault(res)) return undefined;

  try {
    const actor = actorOf(req);

    const rows = await Credential.find({ sharedWith: actor._id, status: { $ne: "retired" } })
      .populate("client", "name company")
      .sort({ label: 1 });

    return res.status(200).json({ items: rows.map((row) => row.safe()) });
  } catch (err) {
    console.error("myCredentials error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
