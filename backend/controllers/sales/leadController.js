import FollowUp from "../../models/FollowUp.js";
import Lead, { LEAD_SOURCES, LEAD_STAGES } from "../../models/Lead.js";
import Requirement from "../../models/Requirement.js";
import SalesActivity from "../../models/SalesActivity.js";
import User, { SALES_PANEL_ROLES } from "../../models/User.js";

import { actorOf } from "../../utils/actor.js";
import { logActivity } from "../../utils/activity.js";
import { notifyUsers } from "../../utils/notify.js";
import { notYours } from "../../utils/salesAccess.js";

/**
 * Leads, which in this app are also the deals.
 *
 * Lead already carries stage, owner, estimated value, won/lost dates, a lost
 * reason and the client it converted into — everything a deal record needs. A
 * parallel Deal model would be a second source of truth for the same five
 * fields, so there isn't one, and the pipeline below is built from stages.
 *
 * The rule that matters on every route here: an executive sees the leads
 * assigned to them and nobody else's. That is `req.salesScope.lead`, spread
 * into every query — a handler that includes it is scoped, and one that
 * forgets is visibly unscoped when you read it. Reaching for somebody else's
 * lead answers 404 rather than 403, because "exists but is not yours" is how a
 * sales floor maps a colleague's pipeline one refusal at a time.
 */

const OPEN_STAGES = LEAD_STAGES.filter((s) => !["won", "lost"].includes(s));

/** The lead, if this account may touch it. Null otherwise. */
const findInScope = (req, id) =>
  Lead.findOne({ _id: id, ...req.salesScope.lead });

/* ---------------------------------------------------------------- list */

// GET /api/sales/leads?stage=&source=&owner=&search=&due=today|overdue
export const listLeads = async (req, res) => {
  try {
    const query = { ...req.salesScope.lead };

    const { stage, source, owner, search, due } = req.query;

    if (stage && stage !== "all") {
      if (stage === "open") query.stage = { $nin: ["won", "lost"] };
      else query.stage = String(stage);
    }
    if (source && source !== "all") query.source = String(source);

    /**
     * A head may filter by person. An executive may not widen past themselves:
     * the scope fragment is spread first and this would overwrite it, so it is
     * only honoured for a head.
     */
    if (owner && owner !== "all" && req.salesScope.isSalesHead) {
      query.owner = String(owner);
    }

    if (search) {
      const regex = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$and = [
        ...(query.$and || []),
        { $or: [{ name: regex }, { company: regex }, { email: regex }, { phone: regex }, { requirement: regex }] },
      ];
    }

    const now = new Date();
    const endOfToday = new Date(new Date().setHours(23, 59, 59, 999));
    if (due === "today") query.followUpOn = { $lte: endOfToday };
    if (due === "overdue") query.followUpOn = { $lt: new Date(now.setHours(0, 0, 0, 0)) };

    const items = await Lead.find(query)
      .populate("owner", "name email role")
      .populate("convertedClient", "name company")
      .sort({ followUpOn: 1, createdAt: -1 })
      .limit(500);

    return res.status(200).json({ items, total: items.length });
  } catch (err) {
    console.error("listLeads error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- get one */

/**
 * GET /api/sales/leads/:id
 *
 * The lead and everything hanging off it — the calls made, the follow-ups
 * owed, the requirements captured. One request, because a sales person opening
 * a lead before a call wants the whole picture and has about four seconds.
 */
export const getLead = async (req, res) => {
  try {
    const lead = await findInScope(req, req.params.id)
      .populate("owner", "name email role")
      .populate("convertedClient", "name company email");

    if (!lead) return notYours(res, "That lead");

    const [activities, followUps, requirements] = await Promise.all([
      SalesActivity.find({ lead: lead._id }).sort({ occurredAt: -1 }).limit(100),
      FollowUp.find({ lead: lead._id }).sort({ dueOn: 1 }).populate("assignedTo", "name"),
      Requirement.find({ lead: lead._id }).sort({ createdAt: -1 }),
    ]);

    return res.status(200).json({ item: lead, activities, followUps, requirements });
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That lead");
    console.error("getLead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- create */

/**
 * POST /api/sales/leads
 *
 * An executive's new lead is theirs. A head may hand it straight to somebody,
 * but the owner defaults to whoever typed it in rather than being left empty —
 * an unowned lead is one nobody is chasing.
 */
export const createLead = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ message: "A lead needs a name" });

    const source = String(req.body.source || "other");
    if (!LEAD_SOURCES.includes(source)) {
      return res.status(400).json({ message: "That is not a lead source we track" });
    }

    const stage = String(req.body.stage || "new");
    if (!LEAD_STAGES.includes(stage)) {
      return res.status(400).json({ message: "That is not a pipeline stage" });
    }

    /**
     * Only a head may create a lead already belonging to somebody else. An
     * executive naming another owner would be assigning work, which is the one
     * thing the two roles differ on.
     */
    let owner = req.sales._id;
    if (req.body.owner && req.salesScope.isSalesHead) {
      const chosen = await User.findOne({
        _id: req.body.owner,
        role: { $in: SALES_PANEL_ROLES },
      }).select("_id");
      if (!chosen) return res.status(400).json({ message: "That person is not on the sales team" });
      owner = chosen._id;
    }

    const lead = await Lead.create({
      name,
      company: String(req.body.company || "").trim(),
      email: String(req.body.email || "").trim().toLowerCase(),
      phone: String(req.body.phone || "").trim(),
      city: String(req.body.city || "").trim(),
      source,
      sourceDetail: String(req.body.sourceDetail || "").trim(),
      requirement: String(req.body.requirement || "").trim(),
      services: Array.isArray(req.body.services) ? req.body.services : [],
      stage,
      estimatedValue: Number(req.body.estimatedValue) || 0,
      followUpOn: req.body.followUpOn || undefined,
      owner,
      createdBy: req.sales._id,
    });

    logActivity(req, {
      action: "created",
      entity: "Lead",
      entityId: lead._id,
      message: `Lead "${lead.name}" added`,
    });

    if (String(owner) !== String(req.sales._id)) {
      notifyUsers([owner], {
        type: "assignment",
        title: "A lead was assigned to you",
        message: `${lead.name}${lead.company ? ` — ${lead.company}` : ""}`,
        link: "/sales/leads",
      });
    }

    return res.status(201).json({ message: "Lead added", item: lead });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("createLead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- update */

/**
 * PUT /api/sales/leads/:id
 *
 * Ordinary edits. Deliberately cannot change the owner, the outcome dates or
 * the converted client — reassigning has its own route because it is a
 * decision, and the outcome fields are stamped by the stage change so they
 * cannot disagree with the stage beside them.
 */
export const updateLead = async (req, res) => {
  try {
    const lead = await findInScope(req, req.params.id);
    if (!lead) return notYours(res, "That lead");

    ["name", "company", "phone", "city", "sourceDetail", "requirement"].forEach((f) => {
      if (req.body[f] !== undefined) lead[f] = String(req.body[f]).trim();
    });

    if (req.body.email !== undefined) {
      lead.email = String(req.body.email).trim().toLowerCase();
    }
    if (req.body.source !== undefined) {
      if (!LEAD_SOURCES.includes(req.body.source)) {
        return res.status(400).json({ message: "That is not a lead source we track" });
      }
      lead.source = req.body.source;
    }
    if (req.body.services !== undefined) {
      lead.services = Array.isArray(req.body.services) ? req.body.services : [];
    }
    if (req.body.estimatedValue !== undefined) {
      lead.estimatedValue = Number(req.body.estimatedValue) || 0;
    }
    if (req.body.followUpOn !== undefined) {
      lead.followUpOn = req.body.followUpOn || undefined;
    }
    if (!lead.name) return res.status(400).json({ message: "A lead needs a name" });

    await lead.save();

    logActivity(req, {
      action: "updated",
      entity: "Lead",
      entityId: lead._id,
      message: `Lead "${lead.name}" updated`,
    });

    return res.status(200).json({ message: "Lead updated", item: lead });
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That lead");
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("updateLead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ----------------------------------------------------------- assignment */

/**
 * PUT /api/sales/leads/:id/assign   { owner }
 *
 * Head only — see requireSalesHead on the route. Reassignment is how work is
 * distributed on a sales floor, and letting an executive pull a colleague's
 * lead onto their own name is how commission arguments start.
 */
export const assignLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: "That lead was not found" });

    const chosen = await User.findOne({
      _id: req.body.owner,
      role: { $in: SALES_PANEL_ROLES },
      status: "active",
    }).select("_id name");

    if (!chosen) {
      return res.status(400).json({ message: "Choose an active member of the sales team" });
    }

    const previous = String(lead.owner || "");
    if (previous === String(chosen._id)) {
      return res.status(200).json({ message: `Already assigned to ${chosen.name}`, item: lead });
    }

    lead.owner = chosen._id;
    await lead.save();

    /**
     * Open follow-ups move with the lead. Leaving them on the previous owner's
     * day list is how a handed-over lead gets chased by the wrong person, or —
     * more often — by nobody, because each assumes the other has it.
     */
    await FollowUp.updateMany(
      { lead: lead._id, status: "pending" },
      { $set: { assignedTo: chosen._id } }
    );

    logActivity(req, {
      action: "updated",
      entity: "Lead",
      entityId: lead._id,
      message: `Lead "${lead.name}" assigned to ${chosen.name}`,
    });

    notifyUsers([chosen._id], {
      type: "assignment",
      title: "A lead was assigned to you",
      message: `${lead.name}${lead.company ? ` — ${lead.company}` : ""}`,
      link: "/sales/leads",
    });

    return res.status(200).json({ message: `Assigned to ${chosen.name}`, item: lead });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "That lead was not found" });
    console.error("assignLead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------------- notes */

/** POST /api/sales/leads/:id/notes   { body } */
export const addNote = async (req, res) => {
  try {
    const lead = await findInScope(req, req.params.id);
    if (!lead) return notYours(res, "That lead");

    const body = String(req.body.body || "").trim();
    if (!body) return res.status(400).json({ message: "Write something first" });

    const me = actorOf(req);
    lead.notes.push({ body, by: me?._id, byName: me?.name || "" });
    await lead.save();

    return res.status(201).json({ message: "Note added", item: lead });
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That lead");
    console.error("addNote error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------- stage & outcome */

/**
 * PUT /api/sales/leads/:id/stage   { stage, lostReason, estimatedValue }
 *
 * Moving a deal through the pipeline, including out of it. Its own route
 * rather than a field on the ordinary edit, because winning and losing stamp
 * dates and one of them demands a reason — none of which should be quietly
 * rewritable by a general update later.
 */
export const setStage = async (req, res) => {
  try {
    const lead = await findInScope(req, req.params.id);
    if (!lead) return notYours(res, "That lead");

    const stage = String(req.body.stage || "").trim();
    if (!LEAD_STAGES.includes(stage)) {
      return res.status(400).json({ message: "That is not a pipeline stage" });
    }

    /**
     * A lost deal has to say why. Without it the lost column is a list of
     * names that teaches nobody anything — and "why did we lose these" is the
     * single most useful question a sales report answers.
     */
    if (stage === "lost") {
      const reason = String(req.body.lostReason || "").trim();
      if (!reason) {
        return res.status(400).json({ message: "Say why the deal was lost" });
      }
      lead.lostReason = reason;
    }

    const was = lead.stage;
    lead.stage = stage;

    // The dates follow the stage rather than being settable beside it
    if (stage === "won" && was !== "won") lead.wonAt = new Date();
    if (stage === "lost" && was !== "lost") lead.lostAt = new Date();
    if (!["won", "lost"].includes(stage)) {
      lead.wonAt = undefined;
      lead.lostAt = undefined;
      lead.lostReason = "";
    }

    if (req.body.estimatedValue !== undefined) {
      lead.estimatedValue = Number(req.body.estimatedValue) || 0;
    }

    await lead.save();

    /**
     * A deal closing is not just the owner's news — it moves a number the
     * whole floor is measured on, and a win is what triggers delivery. Both
     * outcomes go to the heads.
     */
    if (["won", "lost"].includes(stage) && was !== stage) {
      const heads = await User.find({ role: "sales", status: "active" }).distinct("_id");
      notifyUsers(
        heads.filter((h) => String(h) !== String(req.sales._id)),
        {
          type: "general",
          title: stage === "won" ? "Deal won" : "Deal lost",
          message:
            `${lead.name}${lead.company ? ` — ${lead.company}` : ""}` +
            (stage === "lost" ? ` · ${lead.lostReason}` : ""),
          link: "/sales/deals",
        }
      );
    }

    logActivity(req, {
      action: "updated",
      entity: "Lead",
      entityId: lead._id,
      message: `Lead "${lead.name}" moved to ${stage}`,
    });

    return res.status(200).json({ message: `Moved to ${stage}`, item: lead });
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That lead");
    console.error("setStage error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- pipeline */

/**
 * GET /api/sales/leads/pipeline
 *
 * The board, as counts and money per stage. Scoped like everything else, so an
 * executive's board is their own pipeline and a head's is the floor's.
 */
export const pipeline = async (req, res) => {
  try {
    const match = { ...req.salesScope.lead };

    const rows = await Lead.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$stage",
          count: { $sum: 1 },
          value: { $sum: { $ifNull: ["$estimatedValue", 0] } },
        },
      },
    ]);

    const byStage = {};
    LEAD_STAGES.forEach((s) => {
      byStage[s] = { stage: s, count: 0, value: 0 };
    });
    rows.forEach((r) => {
      byStage[r._id] = { stage: r._id, count: r.count, value: r.value };
    });

    const open = OPEN_STAGES.reduce(
      (acc, s) => {
        acc.count += byStage[s].count;
        acc.value += byStage[s].value;
        return acc;
      },
      { count: 0, value: 0 }
    );

    const decided = byStage.won.count + byStage.lost.count;

    return res.status(200).json({
      stages: LEAD_STAGES.map((s) => byStage[s]),
      open,
      won: byStage.won,
      lost: byStage.lost,
      // Of the deals actually decided — counting undecided ones as losses
      // makes a busy month read as a bad one.
      conversionRate: decided ? Math.round((byStage.won.count / decided) * 100) : 0,
    });
  } catch (err) {
    console.error("pipeline error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/sales/leads/lost-reasons
 *
 * Why deals were lost, grouped. The whole point of demanding a reason.
 */
export const lostReasons = async (req, res) => {
  try {
    const rows = await Lead.aggregate([
      { $match: { ...req.salesScope.lead, stage: "lost" } },
      {
        $group: {
          _id: { $toLower: { $ifNull: ["$lostReason", "not given"] } },
          count: { $sum: 1 },
          value: { $sum: { $ifNull: ["$estimatedValue", 0] } },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 25 },
    ]);

    return res.status(200).json({
      items: rows.map((r) => ({ reason: r._id || "not given", count: r.count, value: r.value })),
    });
  } catch (err) {
    console.error("lostReasons error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/sales/leads/sources
 *
 * Where the pipeline comes from and which sources actually convert — the
 * question that decides where next quarter's effort goes.
 */
export const leadSources = async (req, res) => {
  try {
    const rows = await Lead.aggregate([
      { $match: { ...req.salesScope.lead } },
      {
        $group: {
          _id: "$source",
          total: { $sum: 1 },
          won: { $sum: { $cond: [{ $eq: ["$stage", "won"] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ["$stage", "lost"] }, 1, 0] } },
          value: { $sum: { $ifNull: ["$estimatedValue", 0] } },
        },
      },
      { $sort: { total: -1 } },
    ]);

    const byKey = {};
    rows.forEach((r) => {
      byKey[r._id] = r;
    });

    return res.status(200).json({
      items: LEAD_SOURCES.map((source) => {
        const r = byKey[source] || {};
        const decided = (r.won || 0) + (r.lost || 0);
        return {
          source,
          total: r.total || 0,
          won: r.won || 0,
          lost: r.lost || 0,
          value: r.value || 0,
          conversionRate: decided ? Math.round(((r.won || 0) / decided) * 100) : 0,
        };
      }),
    });
  } catch (err) {
    console.error("leadSources error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Middleware: refuse before the shared handler runs.
 *
 * convertLead lives in crmController and is shared with the admin panel, which
 * has no notion of lead ownership. Rather than fork it, this checks the scope
 * first and lets the shared handler do the work it already does correctly.
 */
export const ensureLeadInScope = async (req, res, next) => {
  try {
    const lead = await findInScope(req, req.params.id).select("_id");
    if (!lead) return notYours(res, "That lead");
    return next();
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That lead");
    console.error("ensureLeadInScope error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
