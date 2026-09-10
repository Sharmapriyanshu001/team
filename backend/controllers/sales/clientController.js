import Client from "../../models/Client.js";
import Invoice from "../../models/Invoice.js";
import Lead from "../../models/Lead.js";
import Project from "../../models/Project.js";
import Quotation from "../../models/Quotation.js";
import Requirement from "../../models/Requirement.js";
import SalesActivity from "../../models/SalesActivity.js";
import User, { ADMIN_ROLES, HR_PANEL_ROLES } from "../../models/User.js";

import { hashPassword } from "../../utils/password.js";
import { actorOf } from "../../utils/actor.js";
import { logActivity } from "../../utils/activity.js";
import { notifyUser, notifyUsers } from "../../utils/notify.js";
import { notYours } from "../../utils/salesAccess.js";

/**
 * The companies Sales owns, and what happens after a deal is won.
 *
 * A client here is the same Client record the admin panel, the portal and
 * every project already use — there is no sales-only copy. What differs is
 * which of them this account may see: an executive gets the ones they own or
 * manage, a head gets all of them.
 *
 * The two routes that matter are at the bottom. Winning a deal is not the end
 * of Sales' job; somebody has to turn it into work. `startProject` opens the
 * project, and `handOver` passes the account to Operations — deliberately
 * separate, because a signed deal often waits on a kickoff call before
 * anything is built, and pretending otherwise leaves half-empty projects in
 * the delivery board.
 */

const summarise = (client) => ({
  _id: client._id,
  name: client.name,
  company: client.company || "",
  email: client.email,
  phone: client.phone || "",
  status: client.status,
  owner: client.owner || null,
  accountManager: client.accountManager || null,
  handedOverAt: client.handedOverAt || null,
  sourceLead: client.sourceLead || null,
  sharedWithHr: client.sharedWithHr?.at ? client.sharedWithHr : null,
  gstNumber: client.gstNumber || "",
  createdAt: client.createdAt,
});

/* ---------------------------------------------------------------- list */

// GET /api/sales/clients?search=&handover=pending|done
export const listClients = async (req, res) => {
  try {
    const query = { ...req.salesScope.client };

    const search = String(req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$and = [
        ...(query.$and || []),
        { $or: [{ name: regex }, { company: regex }, { email: regex }, { phone: regex }] },
      ];
    }

    if (req.query.handover === "pending") query.handedOverAt = { $exists: false };
    if (req.query.handover === "done") query.handedOverAt = { $exists: true, $ne: null };
    if (req.query.status && req.query.status !== "all") query.status = String(req.query.status);

    const items = await Client.find(query)
      .select("-password")
      .populate("owner", "name email")
      .populate("accountManager", "name email")
      .sort({ createdAt: -1 })
      .limit(400);

    /**
     * Won but nobody in Operations has picked it up. The number Sales is asked
     * about in every review, so it is counted rather than eyeballed.
     */
    const awaitingHandover = await Client.countDocuments({
      ...req.salesScope.client,
      status: { $ne: "lead" },
      handedOverAt: { $exists: false },
    });

    return res.status(200).json({
      items: items.map(summarise),
      total: items.length,
      counts: { awaitingHandover },
    });
  } catch (err) {
    console.error("sales listClients error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- get one */

/**
 * GET /api/sales/clients/:id
 *
 * Everything Sales needs about one company in a single request: where it came
 * from, what was quoted, what has been invoiced and paid, what is being built,
 * and the whole conversation history.
 */
export const getClient = async (req, res) => {
  try {
    const client = await Client.findOne({ _id: req.params.id, ...req.salesScope.client })
      .select("-password")
      .populate("owner", "name email")
      .populate("accountManager", "name email")
      .populate("sourceLead", "name company source stage estimatedValue wonAt");

    if (!client) return notYours(res, "That client");

    const [quotations, invoices, projects, activities, requirements] = await Promise.all([
      Quotation.find({ client: client._id }).sort({ createdAt: -1 }).limit(50),
      Invoice.find({ client: client._id }).sort({ createdAt: -1 }).limit(50),
      Project.find({ client: client._id }).select("name status progress budget startDate endDate").sort({ createdAt: -1 }),
      SalesActivity.find({ client: client._id }).sort({ occurredAt: -1 }).limit(60),
      Requirement.find({ client: client._id }).sort({ createdAt: -1 }),
    ]);

    /** What the client owes, from the invoices rather than a stored figure. */
    const billed = invoices.reduce((sum, i) => sum + (i.total || 0), 0);
    const received = invoices.reduce(
      (sum, i) => sum + (i.payments || []).reduce((p, pay) => p + (pay.amount || 0), 0),
      0
    );

    return res.status(200).json({
      item: client,
      quotations,
      invoices,
      projects,
      activities,
      requirements,
      money: { billed, received, outstanding: billed - received },
    });
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That client");
    console.error("sales getClient error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- update */

/**
 * PUT /api/sales/clients/:id
 *
 * The commercial contact details Sales owns. Deliberately narrow: portal
 * access, password and status are the admin's, and `accountManager` moves only
 * through the handover route so it always carries a date and a note with it.
 */
export const updateClient = async (req, res) => {
  try {
    const client = await Client.findOne({ _id: req.params.id, ...req.salesScope.client });
    if (!client) return notYours(res, "That client");

    ["name", "company", "phone", "address", "notes"].forEach((f) => {
      if (req.body[f] !== undefined) client[f] = String(req.body[f]).trim();
    });
    if (req.body.email !== undefined) {
      const email = String(req.body.email).trim().toLowerCase();
      if (email && email !== client.email) {
        const taken = await Client.findOne({ email, _id: { $ne: client._id } }).select("_id");
        if (taken) return res.status(409).json({ message: `A client already uses ${email}` });
        client.email = email;
      }
    }
    if (!client.name) return res.status(400).json({ message: "A client needs a name" });

    await client.save();

    logActivity(req, {
      action: "updated",
      entity: "Client",
      entityId: client._id,
      message: `Client "${client.name}" updated`,
    });

    return res.status(200).json({ message: "Client updated", item: summarise(client) });
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That client");
    if (err.code === 11000) return res.status(409).json({ message: "A client already uses that email" });
    console.error("sales updateClient error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- create */

/**
 * POST /api/sales/clients
 *
 * Adding a client directly, without a lead in front of it.
 *
 * Converting a lead was the only way a client could come into being, which
 * works for a pipeline that starts with an enquiry — and not at all for the
 * way a sales floor often actually wins work: somebody signs on the spot, or
 * arrives already agreed through a referral. Making that person go back and
 * invent a lead so they can convert it is paperwork for the software's
 * benefit.
 *
 * The record is the same Client the admin panel, the portal and every project
 * already use. The creator becomes its owner, so an executive can see what
 * they just added — nothing here reaches past the scope everything else in
 * this panel obeys.
 */
export const createClient = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!name) return res.status(400).json({ message: "A client needs a name" });
    if (!email) return res.status(400).json({ message: "An email address is required" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "That does not look like an email address" });
    }

    const taken = await Client.findOne({ email }).select("_id name");
    if (taken) {
      return res.status(409).json({
        message: `A client already exists with that email — "${taken.name}"`,
      });
    }

    const phone = String(req.body.phone || "").trim();

    /**
     * The portal password is the phone number, the same rule the admin's
     * client form and convertLead both follow. No phone means no portal
     * access until somebody sets one — an account with an empty password must
     * never be able to sign in.
     */
    const client = await Client.create({
      name,
      email,
      company: String(req.body.company || "").trim(),
      phone,
      address: String(req.body.address || "").trim(),
      gstNumber: String(req.body.gstNumber || "").trim().toUpperCase(),
      notes: String(req.body.notes || "").trim(),
      password: phone ? hashPassword(phone) : "",
      portalAccess: Boolean(phone),
      status: "active",
      // Whoever added them owns them, which is what keeps it in their scope
      owner: req.sales._id,
    });

    logActivity(req, {
      action: "created",
      entity: "Client",
      entityId: client._id,
      message: `Client "${client.name}" added from the Sales panel`,
    });

    return res.status(201).json({
      message: `${client.name} added`,
      item: summarise(client),
      portal: phone
        ? { loginId: client.email, password: phone }
        : { loginId: client.email, password: null },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "A client already uses that email" });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("sales createClient error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------- send to HR */

/**
 * POST /api/sales/clients/:id/share-hr
 *
 * Hand the client's details to HR.
 *
 * The sales person who signed somebody up holds details HR needs — the
 * registered company name, the GST number, who to invoice, what was agreed —
 * and until now had no way to pass them on except retyping them into a
 * message, which mostly meant not passing them on at all.
 *
 * Sending both notifies every active HR account and stamps the client, because
 * a notification scrolls away and the question HR asks a week later is "has
 * this one reached us". Re-sending is allowed and deliberate: details change,
 * and a second send is how a correction travels. The first send is the one
 * kept on the record.
 */
export const shareWithHr = async (req, res) => {
  try {
    const client = await Client.findOne({ _id: req.params.id, ...req.salesScope.client });
    if (!client) return notYours(res, "That client");

    const me = actorOf(req);
    const note = String(req.body.note || "").trim();
    const resending = Boolean(client.sharedWithHr?.at);

    client.sharedWithHr = {
      at: client.sharedWithHr?.at || new Date(),
      by: client.sharedWithHr?.by || me?._id,
      byName: client.sharedWithHr?.byName || me?.name || "",
      note: note || client.sharedWithHr?.note || "",
    };
    await client.save();

    const hrTeam = await User.find({
      role: { $in: HR_PANEL_ROLES },
      status: "active",
    }).distinct("_id");

    if (!hrTeam.length) {
      return res.status(409).json({
        message: "There is no active HR account to send this to — ask an administrator to open one",
      });
    }

    notifyUsers(hrTeam, {
      type: "general",
      title: resending ? "Client details updated by Sales" : "New client details from Sales",
      message:
        `${client.name}${client.company ? ` — ${client.company}` : ""}` +
        ` · ${client.email}${client.phone ? ` · ${client.phone}` : ""}` +
        (note ? ` · ${note}` : ""),
      link: "/hr/client-records",
    });

    logActivity(req, {
      action: "updated",
      entity: "Client",
      entityId: client._id,
      message: `Client "${client.name}" details sent to HR`,
    });

    return res.status(200).json({
      message: resending
        ? `Updated details sent to HR (${hrTeam.length} account${hrTeam.length === 1 ? "" : "s"})`
        : `Sent to HR (${hrTeam.length} account${hrTeam.length === 1 ? "" : "s"})`,
      item: summarise(client),
    });
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That client");
    console.error("shareWithHr error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------- after the deal is won */

/**
 * POST /api/sales/clients/:id/project
 *
 * Turn a won deal into a real project.
 *
 * The project is created in "planning" with no team on it — picking the team
 * leader and the members is Operations' decision, not Sales'. What Sales
 * carries across is the part only Sales knows: what was actually agreed, and
 * for how much. The captured requirements go into the description rather than
 * being summarised away, because a delivery team reading "website, ₹2,00,000"
 * has to ring somebody to find out what was promised.
 */
export const startProject = async (req, res) => {
  try {
    const client = await Client.findOne({ _id: req.params.id, ...req.salesScope.client });
    if (!client) return notYours(res, "That client");

    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ message: "Give the project a name" });

    /**
     * Requirements are captured against the LEAD, during the sale — and the
     * lead is what the client was converted from. Looking only at the client
     * therefore found nothing on the very path this route exists to serve, and
     * a project opened from a won deal inherited an empty scope.
     *
     * Both links are followed rather than the rows being repointed on
     * conversion: the lead keeps its own history, which is what makes "what
     * did we actually promise them" answerable a year later.
     */
    const requirements = await Requirement.find({
      $or: [
        { client: client._id },
        ...(client.sourceLead ? [{ lead: client.sourceLead }] : []),
      ],
      status: { $in: ["open", "quoted", "approved"] },
    }).select("title summary items timeline");

    /** The lead this client came from, for the scope it was sold on. */
    const lead = client.sourceLead ? await Lead.findById(client.sourceLead).select("requirement estimatedValue") : null;

    const scopeLines = requirements.map((r) => {
      const items = (r.items || []).map((i) => `  - ${i.title}${i.detail ? `: ${i.detail}` : ""}`);
      return [`• ${r.title}`, r.summary && `  ${r.summary}`, ...items].filter(Boolean).join("\n");
    });

    const description = [
      String(req.body.description || "").trim(),
      lead?.requirement && `What they asked for:\n${lead.requirement}`,
      scopeLines.length && `Agreed scope:\n${scopeLines.join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const project = await Project.create({
      name,
      client: client._id,
      description,
      status: "planning",
      priority: ["low", "medium", "high"].includes(req.body.priority) ? req.body.priority : "medium",
      budget: Number(req.body.budget) || lead?.estimatedValue || 0,
      startDate: req.body.startDate || undefined,
      endDate: req.body.endDate || undefined,
      /**
       * A returning client's new project points at their last one. Client
       * already carries `previousProject`; copying it here is what makes the
       * chain readable from either end.
       */
      previousProject: client.previousProject || undefined,
    });

    /** The requirements are now somebody's build, so they say so. */
    await Requirement.updateMany(
      { _id: { $in: requirements.map((r) => r._id) } },
      { $set: { handedToProject: project._id } }
    );

    if (client.status === "lead") {
      client.status = "active";
      await client.save();
    }

    logActivity(req, {
      action: "created",
      entity: "Project",
      entityId: project._id,
      message: `Project "${project.name}" opened for ${client.name}`,
    });

    /**
     * Operations has to know a project has landed, otherwise it sits in
     * planning until somebody happens to look at the board.
     */
    const ops = await User.find({
      role: { $in: ["admin", "super_admin", "operations"] },
      status: "active",
    }).distinct("_id");

    notifyUsers(ops, {
      type: "project",
      title: "A new project came in from Sales",
      message: `${project.name} — ${client.name}`,
      link: `/admin/projects`,
    });

    return res.status(201).json({
      message: `Project "${project.name}" created`,
      project,
      requirementsCarried: requirements.length,
    });
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That client");
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("startProject error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * PUT /api/sales/clients/:id/handover
 *
 * Sales passes the account to Operations.
 *
 * A PUT rather than a POST on purpose: it changes an existing client rather
 * than creating one, and the module guard turns the verb into the permission
 * it demands — as a POST it would ask for "create clients" and tell somebody
 * who pressed Hand Over that they may not add clients.
 */
export const handOver = async (req, res) => {
  try {
    const client = await Client.findOne({ _id: req.params.id, ...req.salesScope.client });
    if (!client) return notYours(res, "That client");

    const manager = await User.findOne({
      _id: req.body.accountManager,
      status: "active",
    }).select("name role");

    if (!manager) {
      return res.status(400).json({ message: "Choose who in Operations is taking this on" });
    }

    const reassigning = Boolean(client.handedOverAt);
    const me = actorOf(req);

    client.accountManager = manager._id;
    client.handedOverAt = client.handedOverAt || new Date();
    client.handedOverBy = me?._id;
    if (req.body.note !== undefined) client.handoverNote = String(req.body.note).trim();
    if (client.status === "lead") client.status = "active";

    await client.save();

    logActivity(req, {
      action: "updated",
      entity: "Client",
      entityId: client._id,
      message: reassigning
        ? `${client.name} reassigned to ${manager.name}`
        : `${client.name} handed over to Operations — ${manager.name}`,
    });

    notifyUser(manager._id, {
      type: "assignment",
      title: reassigning ? "A client was reassigned to you" : "A client was handed over to you",
      message: `${client.name}${client.company ? ` — ${client.company}` : ""}`,
      link: `/admin/clients/${client._id}`,
    });

    return res.status(200).json({
      message: reassigning
        ? `${client.name} reassigned to ${manager.name}`
        : `${client.name} handed over to ${manager.name}`,
      item: summarise(client),
    });
  } catch (err) {
    if (err.name === "CastError") return notYours(res, "That client");
    console.error("sales handOver error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/sales/clients/handover-options
 *
 * Who Sales may hand an account to. Deliberately not every user in the
 * company: Operations, managers and administrators are the people who take
 * delivery, and offering the whole staff list invites a mistake.
 */
export const handoverOptions = async (req, res) => {
  try {
    const people = await User.find({
      role: { $in: ["operations", "manager", "admin", "super_admin"] },
      status: "active",
    })
      .select("name email role")
      .sort({ name: 1 });

    return res.status(200).json({ items: people });
  } catch (err) {
    console.error("handoverOptions error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
