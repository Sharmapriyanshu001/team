import Client from "../../models/Client.js";
import FollowUp, { FOLLOWUP_MODES } from "../../models/FollowUp.js";
import Lead from "../../models/Lead.js";
import Requirement, { REQUIREMENT_STATUS } from "../../models/Requirement.js";
import SalesActivity, { ACTIVITY_TYPES } from "../../models/SalesActivity.js";
import User, { SALES_PANEL_ROLES } from "../../models/User.js";

import { actorOf } from "../../utils/actor.js";
import { logActivity } from "../../utils/activity.js";
import { notifyUsers } from "../../utils/notify.js";
import { notYours } from "../../utils/salesAccess.js";

/**
 * The three things that hang off a deal: what was promised, what was said, and
 * what was asked for.
 *
 * They share a file because they share one awkward problem, and solving it
 * once is the reason this is not three: each of them attaches to either a lead
 * or a client, and "may this account touch the thing it is attached to" is the
 * only access question any of them has. `resolveParent` answers it once.
 */

/* ------------------------------------------------------------ the parent */

/**
 * Which lead or client this record hangs off, and whether this account may
 * reach it.
 *
 * Returns null when the parent is missing or out of scope — the caller answers
 * 404 either way, because telling somebody a lead exists but is not theirs is
 * how a colleague's pipeline gets mapped one refusal at a time.
 */
const resolveParent = async (req, body) => {
  const leadId = body.lead || body.leadId;
  const clientId = body.client || body.clientId;

  if (leadId) {
    const lead = await Lead.findOne({ _id: leadId, ...req.salesScope.lead }).select("_id name owner");
    return lead ? { kind: "lead", doc: lead, link: { lead: lead._id } } : null;
  }

  if (clientId) {
    const client = await Client.findOne({ _id: clientId, ...req.salesScope.client }).select(
      "_id name owner accountManager"
    );
    return client ? { kind: "client", doc: client, link: { client: client._id } } : null;
  }

  return null;
};

/** Restrict a list to the leads and clients this account may see. */
const scopeList = async (req) => {
  if (req.salesScope.isSalesHead) return {};

  const [leadIds, clientIds] = await Promise.all([
    Lead.find(req.salesScope.lead).distinct("_id"),
    Client.find(req.salesScope.client).distinct("_id"),
  ]);

  return { $or: [{ lead: { $in: leadIds } }, { client: { $in: clientIds } }] };
};

/* ====================================================== FOLLOW-UPS */

/**
 * GET /api/sales/followups?view=today|overdue|upcoming|done&assignedTo=
 *
 * The "who do I call today" list, which is the screen a sales desk actually
 * lives on.
 */
export const listFollowUps = async (req, res) => {
  try {
    const query = await scopeList(req);

    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
    const endOfToday = new Date(new Date().setHours(23, 59, 59, 999));

    const view = String(req.query.view || "open");
    if (view === "today") {
      query.status = "pending";
      query.dueOn = { $gte: startOfToday, $lte: endOfToday };
    } else if (view === "overdue") {
      query.status = "pending";
      query.dueOn = { $lt: startOfToday };
    } else if (view === "upcoming") {
      query.status = "pending";
      query.dueOn = { $gt: endOfToday };
    } else if (view === "done") {
      query.status = "done";
    } else if (view === "open") {
      query.status = "pending";
    }

    /** A head may narrow to one person; an executive is already narrowed. */
    if (req.query.assignedTo && req.query.assignedTo !== "all" && req.salesScope.isSalesHead) {
      query.assignedTo = req.query.assignedTo;
    }

    const items = await FollowUp.find(query)
      .populate("lead", "name company stage")
      .populate("client", "name company")
      .populate("assignedTo", "name")
      .sort({ dueOn: 1 })
      .limit(400);

    /** The three numbers the tabs show, counted unfiltered by view. */
    const base = await scopeList(req);
    const [overdue, today, upcoming] = await Promise.all([
      FollowUp.countDocuments({ ...base, status: "pending", dueOn: { $lt: startOfToday } }),
      FollowUp.countDocuments({
        ...base,
        status: "pending",
        dueOn: { $gte: startOfToday, $lte: endOfToday },
      }),
      FollowUp.countDocuments({ ...base, status: "pending", dueOn: { $gt: endOfToday } }),
    ]);

    return res.status(200).json({ items, total: items.length, counts: { overdue, today, upcoming } });
  } catch (err) {
    console.error("listFollowUps error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** POST /api/sales/followups */
export const createFollowUp = async (req, res) => {
  try {
    const parent = await resolveParent(req, req.body);
    if (!parent) return notYours(res, "That lead or client");

    const title = String(req.body.title || "").trim();
    if (!title) return res.status(400).json({ message: "Say what the follow-up is for" });

    const dueOn = new Date(req.body.dueOn);
    if (Number.isNaN(dueOn.getTime())) {
      return res.status(400).json({ message: "A follow-up needs a date" });
    }

    const mode = String(req.body.mode || "call");
    if (!FOLLOWUP_MODES.includes(mode)) {
      return res.status(400).json({ message: "That is not a way we follow up" });
    }

    /**
     * Assigning somebody else's follow-up is a head's call, the same rule lead
     * assignment follows. An executive's follow-up is their own.
     */
    let assignedTo = req.sales._id;
    if (req.body.assignedTo && req.salesScope.isSalesHead) {
      const chosen = await User.findOne({
        _id: req.body.assignedTo,
        role: { $in: SALES_PANEL_ROLES },
      }).select("_id");
      if (!chosen) return res.status(400).json({ message: "That person is not on the sales team" });
      assignedTo = chosen._id;
    } else if (parent.kind === "lead" && parent.doc.owner) {
      // Default to whoever owns the lead, which is usually the caller anyway
      assignedTo = parent.doc.owner;
    }

    const followUp = await FollowUp.create({
      ...parent.link,
      title,
      notes: String(req.body.notes || "").trim(),
      mode,
      dueOn,
      assignedTo,
      createdBy: req.sales._id,
    });

    /**
     * Lead.followUpOn is what every existing screen sorts by, including the
     * admin panel's. Kept in step here so those keep working untouched — the
     * earliest thing still owed is the next date.
     */
    if (parent.kind === "lead") {
      await syncLeadNextFollowUp(parent.doc._id);
    }

    if (String(assignedTo) !== String(req.sales._id)) {
      notifyUsers([assignedTo], {
        type: "assignment",
        title: "A follow-up was assigned to you",
        message: `${title} · ${dueOn.toLocaleDateString("en-IN")}`,
        link: "/sales/followups",
      });
    }

    return res.status(201).json({ message: "Follow-up added", item: followUp });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("createFollowUp error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** The lead's next-date field, recomputed from the follow-ups that remain. */
const syncLeadNextFollowUp = async (leadId) => {
  const next = await FollowUp.findOne({ lead: leadId, status: "pending" })
    .sort({ dueOn: 1 })
    .select("dueOn");

  await Lead.updateOne({ _id: leadId }, { $set: { followUpOn: next?.dueOn || null } });
};

/** The follow-up, if this account may touch it. */
const followUpInScope = async (req, id) => {
  const followUp = await FollowUp.findById(id);
  if (!followUp) return null;
  if (req.salesScope.isSalesHead) return followUp;

  const allowed = await scopeList(req);
  const match = await FollowUp.findOne({ _id: followUp._id, ...allowed }).select("_id");
  return match ? followUp : null;
};

/** PUT /api/sales/followups/:id */
export const updateFollowUp = async (req, res) => {
  try {
    const followUp = await followUpInScope(req, req.params.id);
    if (!followUp) return notYours(res, "That follow-up");

    if (req.body.title !== undefined) followUp.title = String(req.body.title).trim();
    if (req.body.notes !== undefined) followUp.notes = String(req.body.notes).trim();
    if (req.body.dueOn !== undefined) {
      const d = new Date(req.body.dueOn);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: "That is not a date" });
      followUp.dueOn = d;
    }
    if (req.body.mode !== undefined && FOLLOWUP_MODES.includes(req.body.mode)) {
      followUp.mode = req.body.mode;
    }
    if (req.body.assignedTo !== undefined && req.salesScope.isSalesHead) {
      followUp.assignedTo = req.body.assignedTo || undefined;
    }
    if (!followUp.title) return res.status(400).json({ message: "Say what the follow-up is for" });

    await followUp.save();
    if (followUp.lead) await syncLeadNextFollowUp(followUp.lead);

    return res.status(200).json({ message: "Follow-up updated", item: followUp });
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That follow-up");
    console.error("updateFollowUp error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * PUT /api/sales/followups/:id/complete   { outcome, logActivity, nextDueOn }
 *
 * Closing one, and — because this is the moment somebody has just put the
 * phone down — optionally writing what happened and booking the next one in
 * the same request. Three screens' worth of clicking, collapsed into the one
 * action a person actually takes.
 */
export const completeFollowUp = async (req, res) => {
  try {
    const followUp = await followUpInScope(req, req.params.id);
    if (!followUp) return notYours(res, "That follow-up");

    const status = String(req.body.status || "done");
    if (!["done", "missed", "cancelled"].includes(status)) {
      return res.status(400).json({ message: "Close it as done, missed or cancelled" });
    }

    const me = actorOf(req);
    followUp.status = status;
    followUp.outcome = String(req.body.outcome || "").trim();
    followUp.completedBy = me?._id;
    followUp.completedByName = me?.name || "";
    await followUp.save();

    /** What happened, written into the history rather than lost with the row. */
    let activity = null;
    if (req.body.summary || status === "done") {
      activity = await SalesActivity.create({
        lead: followUp.lead,
        client: followUp.client,
        type: ACTIVITY_TYPES.includes(followUp.mode) ? followUp.mode : "call",
        direction: "outbound",
        subject: followUp.title,
        summary: String(req.body.summary || followUp.outcome || "").trim(),
        outcome: status === "done" ? "connected" : "no_answer",
        occurredAt: new Date(),
        by: me?._id,
        byName: me?.name || "",
      });
    }

    /** Book the next one without leaving the screen. */
    let next = null;
    if (req.body.nextDueOn) {
      const dueOn = new Date(req.body.nextDueOn);
      if (!Number.isNaN(dueOn.getTime())) {
        next = await FollowUp.create({
          lead: followUp.lead,
          client: followUp.client,
          title: String(req.body.nextTitle || followUp.title).trim(),
          mode: followUp.mode,
          dueOn,
          assignedTo: followUp.assignedTo,
          createdBy: req.sales._id,
        });
      }
    }

    if (followUp.lead) await syncLeadNextFollowUp(followUp.lead);

    return res.status(200).json({
      message: status === "done" ? "Marked done" : `Marked ${status}`,
      item: followUp,
      activity,
      next,
    });
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That follow-up");
    console.error("completeFollowUp error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** DELETE /api/sales/followups/:id */
export const removeFollowUp = async (req, res) => {
  try {
    const followUp = await followUpInScope(req, req.params.id);
    if (!followUp) return notYours(res, "That follow-up");

    const leadId = followUp.lead;
    await followUp.deleteOne();
    if (leadId) await syncLeadNextFollowUp(leadId);

    return res.status(200).json({ message: "Follow-up removed" });
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That follow-up");
    console.error("removeFollowUp error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ====================================================== ACTIVITIES */

/**
 * GET /api/sales/activities?lead=&client=&type=
 *
 * The communication history — calls, meetings, emails, site visits.
 */
export const listActivities = async (req, res) => {
  try {
    const query = await scopeList(req);

    if (req.query.lead) {
      const lead = await Lead.findOne({ _id: req.query.lead, ...req.salesScope.lead }).select("_id");
      if (!lead) return notYours(res, "That lead");
      delete query.$or;
      query.lead = lead._id;
    }
    if (req.query.client) {
      const client = await Client.findOne({
        _id: req.query.client,
        ...req.salesScope.client,
      }).select("_id");
      if (!client) return notYours(res, "That client");
      delete query.$or;
      query.client = client._id;
    }
    if (req.query.type && req.query.type !== "all") query.type = String(req.query.type);

    const items = await SalesActivity.find(query)
      .populate("lead", "name company")
      .populate("client", "name company")
      .sort({ occurredAt: -1 })
      .limit(300);

    return res.status(200).json({ items, total: items.length });
  } catch (err) {
    console.error("listActivities error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** POST /api/sales/activities — log a call, meeting or email after the fact. */
export const createActivity = async (req, res) => {
  try {
    const parent = await resolveParent(req, req.body);
    if (!parent) return notYours(res, "That lead or client");

    const type = String(req.body.type || "call");
    if (!ACTIVITY_TYPES.includes(type)) {
      return res.status(400).json({ message: "That is not a kind of contact we log" });
    }

    const me = actorOf(req);
    const activity = await SalesActivity.create({
      ...parent.link,
      type,
      direction: req.body.direction === "inbound" ? "inbound" : "outbound",
      subject: String(req.body.subject || "").trim(),
      summary: String(req.body.summary || "").trim(),
      outcome: String(req.body.outcome || "connected"),
      occurredAt: req.body.occurredAt ? new Date(req.body.occurredAt) : new Date(),
      durationMinutes: Number(req.body.durationMinutes) || 0,
      participants: Array.isArray(req.body.participants) ? req.body.participants : [],
      by: me?._id,
      byName: me?.name || "",
    });

    /**
     * A logged conversation is the strongest signal a lead is alive, so it
     * moves the lead's own "last touched" ordering without anybody having to
     * remember to edit the lead as well.
     */
    if (parent.kind === "lead") {
      await Lead.updateOne({ _id: parent.doc._id }, { $set: { updatedAt: new Date() } });
    }

    return res.status(201).json({ message: "Logged", item: activity });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("createActivity error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ====================================================== REQUIREMENTS */

/** GET /api/sales/requirements?lead=&client=&status= */
export const listRequirements = async (req, res) => {
  try {
    const query = await scopeList(req);

    if (req.query.lead) {
      const lead = await Lead.findOne({ _id: req.query.lead, ...req.salesScope.lead }).select("_id");
      if (!lead) return notYours(res, "That lead");
      delete query.$or;
      query.lead = lead._id;
    }
    if (req.query.status && req.query.status !== "all") query.status = String(req.query.status);

    const items = await Requirement.find(query)
      .populate("lead", "name company stage")
      .populate("client", "name company")
      .sort({ createdAt: -1 })
      .limit(300);

    return res.status(200).json({ items, total: items.length });
  } catch (err) {
    console.error("listRequirements error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** POST /api/sales/requirements */
export const createRequirement = async (req, res) => {
  try {
    const parent = await resolveParent(req, req.body);
    if (!parent) return notYours(res, "That lead or client");

    const title = String(req.body.title || "").trim();
    if (!title) return res.status(400).json({ message: "Give the requirement a title" });

    const me = actorOf(req);
    const requirement = await Requirement.create({
      ...parent.link,
      title,
      summary: String(req.body.summary || "").trim(),
      services: Array.isArray(req.body.services) ? req.body.services : [],
      items: Array.isArray(req.body.items) ? req.body.items : [],
      budgetFrom: Number(req.body.budgetFrom) || 0,
      budgetTo: Number(req.body.budgetTo) || 0,
      timeline: String(req.body.timeline || "").trim(),
      expectedStart: req.body.expectedStart || undefined,
      priority: ["low", "medium", "high"].includes(req.body.priority) ? req.body.priority : "medium",
      notes: String(req.body.notes || "").trim(),
      capturedBy: me?._id,
      capturedByName: me?.name || "",
    });

    logActivity(req, {
      action: "created",
      entity: "Requirement",
      entityId: requirement._id,
      message: `Requirement "${title}" captured`,
    });

    return res.status(201).json({ message: "Requirement captured", item: requirement });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("createRequirement error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

const requirementInScope = async (req, id) => {
  const requirement = await Requirement.findById(id);
  if (!requirement) return null;
  if (req.salesScope.isSalesHead) return requirement;

  const allowed = await scopeList(req);
  const match = await Requirement.findOne({ _id: requirement._id, ...allowed }).select("_id");
  return match ? requirement : null;
};

/** PUT /api/sales/requirements/:id */
export const updateRequirement = async (req, res) => {
  try {
    const requirement = await requirementInScope(req, req.params.id);
    if (!requirement) return notYours(res, "That requirement");

    ["title", "summary", "timeline", "notes"].forEach((f) => {
      if (req.body[f] !== undefined) requirement[f] = String(req.body[f]).trim();
    });
    if (req.body.services !== undefined) {
      requirement.services = Array.isArray(req.body.services) ? req.body.services : [];
    }
    if (req.body.items !== undefined) {
      requirement.items = Array.isArray(req.body.items) ? req.body.items : [];
    }
    if (req.body.budgetFrom !== undefined) requirement.budgetFrom = Number(req.body.budgetFrom) || 0;
    if (req.body.budgetTo !== undefined) requirement.budgetTo = Number(req.body.budgetTo) || 0;
    if (req.body.expectedStart !== undefined) {
      requirement.expectedStart = req.body.expectedStart || undefined;
    }
    if (["low", "medium", "high"].includes(req.body.priority)) {
      requirement.priority = req.body.priority;
    }
    if (REQUIREMENT_STATUS.includes(req.body.status)) requirement.status = req.body.status;

    if (!requirement.title) return res.status(400).json({ message: "Give the requirement a title" });

    await requirement.save();

    return res.status(200).json({ message: "Requirement updated", item: requirement });
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That requirement");
    console.error("updateRequirement error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** DELETE /api/sales/requirements/:id */
export const removeRequirement = async (req, res) => {
  try {
    const requirement = await requirementInScope(req, req.params.id);
    if (!requirement) return notYours(res, "That requirement");

    await requirement.deleteOne();
    return res.status(200).json({ message: "Requirement removed" });
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That requirement");
    console.error("removeRequirement error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
