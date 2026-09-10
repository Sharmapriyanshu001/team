import Lead from "../models/Lead.js";
import Client from "../models/Client.js";
import ServiceItem from "../models/ServiceItem.js";
import Quotation from "../models/Quotation.js";
import Invoice from "../models/Invoice.js";

import { buildCrud } from "../utils/crud.js";
import {
  applyTotals,
  crossesState,
  financialYear,
  readLines,
  saveNumbered,
  settings,
} from "../utils/invoicing.js";
import { logActivity } from "../utils/activity.js";
import { actorOf } from "../utils/actor.js";
import { notifyUsers } from "../utils/notify.js";
import { hashPassword } from "../utils/password.js";

/**
 * The money side: who might buy, what they were quoted, what they were billed,
 * and what has actually arrived.
 */

// Re-exported because receivables reports by it, and so does the ads module
export { financialYear };

/* ------------------------------------------------------------------- leads */

export const leads = buildCrud(Lead, {
  entity: "Lead",
  searchFields: ["name", "company", "email", "phone", "requirement"],
  filterFields: ["stage", "source", "owner"],
  populate: [
    { path: "owner", select: "name email" },
    { path: "convertedClient", select: "name company" },
  ],
  sort: { followUpOn: 1, createdAt: -1 },

  beforeSave: (payload, req, existing) => {
    const data = { ...payload };

    /**
     * Winning and losing stamp their own dates, and moving back out of either
     * clears them — a lead reopened after a "lost" would otherwise keep a lost
     * date, and every report that counts by it would count it twice.
     */
    if (data.stage === "won" && existing?.stage !== "won") data.wonAt = new Date();
    if (data.stage === "lost" && existing?.stage !== "lost") data.lostAt = new Date();
    if (data.stage && !["won", "lost"].includes(data.stage)) {
      data.wonAt = null;
      data.lostAt = null;
    }

    if (data.owner === "") data.owner = null;
    if (!existing) data.createdBy = req.admin?._id;

    return data;
  },

  afterSave: (doc, req, { isNew, previous }) => {
    if (!doc.owner) return;
    if (!isNew && String(previous?.owner || "") === String(doc.owner)) return;

    notifyUsers([doc.owner], {
      type: "assignment",
      title: "A lead was assigned to you",
      message: `${doc.name}${doc.company ? ` — ${doc.company}` : ""}`,
      link: "/crm/leads",
    });
  },
});

/** What was said. Appended rather than replacing a single notes field. */
export const addLeadNote = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    const body = String(req.body.body || "").trim();
    if (!body) return res.status(400).json({ message: "Write something first" });

    lead.notes.push({ body, by: req.admin?._id, byName: req.admin?.name || "" });

    // Logging a call almost always means setting the next one
    if (req.body.followUpOn !== undefined) lead.followUpOn = req.body.followUpOn || null;
    if (req.body.stage) lead.stage = req.body.stage;

    await lead.save();

    return res.status(200).json({ message: "Note added", item: lead });
  } catch (err) {
    console.error("addLeadNote error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Turn a won lead into a client.
 *
 * The lead is kept and linked rather than deleted. Where the work came from and
 * how long it took to close are the only things that tell you which sources are
 * worth the effort, and both are lost the moment the lead is.
 */
export const convertLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    if (lead.convertedClient) {
      return res.status(409).json({ message: "This lead has already been converted" });
    }
    if (!lead.email) {
      return res.status(400).json({ message: "Add an email address before converting" });
    }

    const existing = await Client.findOne({ email: lead.email.toLowerCase() });
    if (existing) {
      return res.status(409).json({
        message: `A client already exists with that email — "${existing.name}"`,
      });
    }

    // The portal password is the phone number, the same rule the client form
    // uses. No phone means no portal access until an admin sets one.
    const client = await Client.create({
      name: lead.name,
      company: lead.company,
      email: lead.email.toLowerCase(),
      phone: lead.phone,
      address: lead.city,
      password: lead.phone ? hashPassword(lead.phone) : "",
      portalAccess: Boolean(lead.phone),
      status: "active",
      notes: lead.requirement,
      /**
       * Both halves of the link, written at the one moment both records are in
       * hand. The lead pointing at its client was already enough to stop a
       * second conversion; this direction is what lets the client's own page
       * show where the work came from and who closed it without searching
       * every lead for a matching id.
       */
      sourceLead: lead._id,
      owner: lead.owner || actorOf(req)?._id,
    });

    lead.convertedClient = client._id;
    lead.stage = "won";
    lead.wonAt = lead.wonAt || new Date();
    await lead.save();

    logActivity(req, {
      action: "created",
      entity: "Client",
      entityId: client._id,
      message: `Lead "${lead.name}" converted to a client`,
    });

    return res.status(201).json({ message: "Converted to a client", client, lead });
  } catch (err) {
    console.error("convertLead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** The pipeline, as numbers. */
export const pipeline = async (req, res) => {
  try {
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
    const endOfToday = new Date(new Date().setHours(23, 59, 59, 999));
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [byStage, overdue, dueToday, wonThisMonth] = await Promise.all([
      Lead.aggregate([
        { $group: { _id: "$stage", count: { $sum: 1 }, value: { $sum: "$estimatedValue" } } },
      ]),
      Lead.countDocuments({
        stage: { $nin: ["won", "lost"] },
        followUpOn: { $lt: startOfToday },
      }),
      Lead.countDocuments({
        stage: { $nin: ["won", "lost"] },
        followUpOn: { $gte: startOfToday, $lte: endOfToday },
      }),
      Lead.countDocuments({ stage: "won", wonAt: { $gte: monthStart } }),
    ]);

    const stages = {};
    byStage.forEach((row) => {
      stages[row._id] = { count: row.count, value: row.value };
    });

    return res.status(200).json({ stages, overdue, dueToday, wonThisMonth });
  } catch (err) {
    console.error("pipeline error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------- the rate card */

export const services = buildCrud(ServiceItem, {
  entity: "Service",
  searchFields: ["name", "category", "hsnSac"],
  filterFields: ["active", "category"],
  sort: { name: 1 },
});

/* ------------------------------------------------------------- quotations */

export const quotations = buildCrud(Quotation, {
  entity: "Quotation",
  searchFields: ["number", "title"],
  filterFields: ["status", "client", "lead"],
  populate: [
    { path: "client", select: "name company gstNumber" },
    { path: "lead", select: "name company" },
  ],
  sort: { createdAt: -1 },
  label: (doc) => doc?.number || "",
});

export const createQuotation = async (req, res) => {
  try {
    const lines = readLines(req.body.lines);
    if (!lines.length) return res.status(400).json({ message: "Add at least one line" });

    if (!req.body.client && !req.body.lead) {
      return res.status(400).json({ message: "A quote goes to a client or a lead" });
    }

    const client = req.body.client ? await Client.findById(req.body.client) : null;
    const config = await settings();

    const quote = new Quotation({
      client: req.body.client || null,
      lead: req.body.lead || null,
      title: req.body.title || "",
      discount: Number(req.body.discount) || 0,
      status: req.body.status || "draft",
      validUntil: req.body.validUntil || null,
      terms: req.body.terms || config?.invoiceTerms || "",
      notes: req.body.notes || "",
      createdBy: req.admin?._id,
    });

    applyTotals(quote, lines, await crossesState(client));
    await saveNumbered(quote, Quotation, config?.quotationPrefix || "QT");

    logActivity(req, {
      action: "created",
      entity: "Quotation",
      entityId: quote._id,
      message: `Quotation ${quote.number} for ₹${quote.total}`,
    });

    return res.status(201).json({ message: "Quotation created", item: quote });
  } catch (err) {
    console.error("createQuotation error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

export const updateQuotation = async (req, res) => {
  try {
    const quote = await Quotation.findById(req.params.id);
    if (!quote) return res.status(404).json({ message: "Quotation not found" });

    if (quote.invoice) {
      return res.status(409).json({
        message: "This quotation has already been invoiced and can no longer be changed",
      });
    }

    ["title", "validUntil", "terms", "notes"].forEach((field) => {
      if (req.body[field] !== undefined) quote[field] = req.body[field];
    });

    if (req.body.status !== undefined) {
      quote.status = req.body.status;
      if (req.body.status === "sent" && !quote.sentAt) quote.sentAt = new Date();
      if (["accepted", "rejected"].includes(req.body.status)) quote.respondedAt = new Date();
    }

    if (req.body.lines !== undefined || req.body.discount !== undefined) {
      if (req.body.discount !== undefined) quote.discount = Number(req.body.discount) || 0;
      const lines = req.body.lines !== undefined ? readLines(req.body.lines) : quote.lines;
      const client = quote.client ? await Client.findById(quote.client) : null;
      applyTotals(quote, lines, await crossesState(client));
    }

    await quote.save();
    return res.status(200).json({ message: "Quotation updated", item: quote });
  } catch (err) {
    console.error("updateQuotation error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Raise the invoice this quote became.
 *
 * The lines are copied across as they stand rather than re-derived, so the
 * client is billed exactly what they accepted. The totals are recomputed from
 * those lines all the same — if the client's GSTIN has been filled in since the
 * quote, the tax split may legitimately differ even though nothing about the
 * price has.
 */
export const quotationToInvoice = async (req, res) => {
  try {
    const quote = await Quotation.findById(req.params.id);
    if (!quote) return res.status(404).json({ message: "Quotation not found" });
    if (quote.invoice) {
      return res.status(409).json({ message: "This quotation has already been invoiced" });
    }

    const clientId = req.body.client || quote.client;
    if (!clientId) {
      return res.status(400).json({
        message: "Convert the lead to a client first — an invoice has to be addressed to one",
      });
    }

    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ message: "Client not found" });

    const config = await settings();

    const invoice = new Invoice({
      client: client._id,
      quotation: quote._id,
      title: quote.title,
      billedTo: {
        name: client.name,
        company: client.company,
        address: client.address,
        gstNumber: client.gstNumber,
        email: client.email,
        phone: client.phone,
      },
      discount: quote.discount,
      status: "draft",
      dueOn: req.body.dueOn || null,
      terms: quote.terms || config?.invoiceTerms || "",
      createdBy: req.admin?._id,
    });

    applyTotals(
      invoice,
      quote.lines.map((line) => line.toObject()),
      await crossesState(client)
    );
    invoice.settleStatus();
    await saveNumbered(invoice, Invoice, config?.invoicePrefix || "INV");

    quote.invoice = invoice._id;
    quote.status = "accepted";
    quote.respondedAt = quote.respondedAt || new Date();
    await quote.save();

    logActivity(req, {
      action: "created",
      entity: "Invoice",
      entityId: invoice._id,
      message: `Invoice ${invoice.number} raised from quotation ${quote.number}`,
    });

    return res.status(201).json({ message: "Invoice raised", item: invoice });
  } catch (err) {
    console.error("quotationToInvoice error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/* --------------------------------------------------------------- invoices */

export const invoices = buildCrud(Invoice, {
  entity: "Invoice",
  searchFields: ["number", "title", "billedTo.company", "billedTo.name"],
  filterFields: ["status", "client", "project"],
  populate: [{ path: "client", select: "name company" }],
  sort: { issuedOn: -1 },
  label: (doc) => doc?.number || "",
});

export const createInvoice = async (req, res) => {
  try {
    const lines = readLines(req.body.lines);
    if (!lines.length) return res.status(400).json({ message: "Add at least one line" });

    const client = await Client.findById(req.body.client);
    if (!client) return res.status(400).json({ message: "Pick the client this is billed to" });

    const config = await settings();

    const invoice = new Invoice({
      client: client._id,
      project: req.body.project || null,
      seoProject: req.body.seoProject || null,
      title: req.body.title || "",
      billedTo: {
        name: client.name,
        company: client.company,
        address: client.address,
        gstNumber: client.gstNumber,
        email: client.email,
        phone: client.phone,
      },
      discount: Number(req.body.discount) || 0,
      status: req.body.status || "draft",
      dueOn: req.body.dueOn || null,
      isRecurring: Boolean(req.body.isRecurring),
      periodLabel: req.body.periodLabel || "",
      terms: req.body.terms || config?.invoiceTerms || "",
      notes: req.body.notes || "",
      createdBy: req.admin?._id,
    });

    applyTotals(invoice, lines, await crossesState(client));
    invoice.settleStatus();
    await saveNumbered(invoice, Invoice, config?.invoicePrefix || "INV");

    logActivity(req, {
      action: "created",
      entity: "Invoice",
      entityId: invoice._id,
      message: `Invoice ${invoice.number} for ₹${invoice.total}`,
    });

    return res.status(201).json({ message: "Invoice created", item: invoice });
  } catch (err) {
    console.error("createInvoice error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

export const updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    /**
     * Once an invoice has been sent its figures are fixed. Changing what a
     * client has already been billed — rather than issuing a credit note or a
     * fresh invoice — is how a set of books stops agreeing with the returns
     * filed from it.
     */
    const figuresLocked = invoice.status !== "draft";

    if ((req.body.lines !== undefined || req.body.discount !== undefined) && figuresLocked) {
      return res.status(409).json({
        message:
          "This invoice has already been issued — cancel it and raise a new one rather than changing the amounts",
      });
    }

    ["title", "dueOn", "terms", "notes", "project", "seoProject", "periodLabel"].forEach((field) => {
      if (req.body[field] !== undefined) invoice[field] = req.body[field] || null;
    });

    if (!figuresLocked && (req.body.lines !== undefined || req.body.discount !== undefined)) {
      if (req.body.discount !== undefined) invoice.discount = Number(req.body.discount) || 0;
      const lines = req.body.lines !== undefined ? readLines(req.body.lines) : invoice.lines;
      const client = await Client.findById(invoice.client);
      applyTotals(invoice, lines, await crossesState(client));
    }

    if (req.body.status !== undefined) {
      invoice.status = req.body.status;
      if (req.body.status === "sent" && !invoice.sentAt) invoice.sentAt = new Date();
    }

    invoice.settleStatus();
    await invoice.save();

    return res.status(200).json({ message: "Invoice updated", item: invoice });
  } catch (err) {
    console.error("updateInvoice error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** Money in. The status follows from this, never the other way round. */
export const addPayment = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    if (invoice.status === "draft") {
      return res.status(409).json({ message: "Send the invoice before recording a payment" });
    }
    if (invoice.status === "cancelled") {
      return res.status(409).json({ message: "This invoice was cancelled" });
    }

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Enter the amount received" });
    }

    /**
     * Refused rather than allowed and flagged. An overpayment is nearly always
     * a typo — a digit too many, or the same payment entered twice — and an
     * invoice showing a negative balance is a question somebody has to answer
     * from bank statements weeks later.
     */
    if (amount > invoice.balance + 0.01) {
      return res.status(400).json({
        message: `That is more than the ₹${invoice.balance.toLocaleString(
          "en-IN"
        )} still outstanding on this invoice`,
      });
    }

    invoice.payments.push({
      amount,
      receivedOn: req.body.receivedOn || new Date(),
      mode: req.body.mode || "bank_transfer",
      reference: req.body.reference || "",
      note: req.body.note || "",
      recordedBy: req.admin?._id,
      recordedByName: req.admin?.name || "",
    });

    invoice.settleStatus();
    await invoice.save();

    logActivity(req, {
      action: "updated",
      entity: "Invoice",
      entityId: invoice._id,
      message: `₹${amount} received against ${invoice.number} — ${invoice.status}`,
    });

    return res.status(200).json({ message: "Payment recorded", item: invoice });
  } catch (err) {
    console.error("addPayment error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const removePayment = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const payment = invoice.payments.id(req.params.paymentId);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    payment.deleteOne();
    invoice.settleStatus();
    await invoice.save();

    logActivity(req, {
      action: "deleted",
      entity: "Invoice",
      entityId: invoice._id,
      message: `A payment was removed from ${invoice.number}`,
    });

    return res.status(200).json({ message: "Payment removed", item: invoice });
  } catch (err) {
    console.error("removePayment error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** One invoice, with everything a printable copy needs. */
export const invoiceDetail = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate("client", "name company email phone address gstNumber")
      .populate("project", "name")
      .populate("quotation", "number");

    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    return res.status(200).json({ item: invoice, company: await settings() });
  } catch (err) {
    console.error("invoiceDetail error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * What is owed and what came in — the two questions a studio owner actually
 * asks about a month.
 */
export const receivables = async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(Number(financialYear().split("-")[0]), 3, 1);

    const owing = { status: { $in: ["sent", "partly_paid", "overdue"] } };

    /**
     * Overdue is computed from the due date rather than read from the status.
     * Status is only refreshed when an invoice is touched, so one that quietly
     * went past its date last week would still say "sent".
     */
    const [outstanding, overdueAgg, billedThisMonth, receivedThisMonth, receivedThisYear, drafts] =
      await Promise.all([
        Invoice.aggregate([
          { $match: owing },
          { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$balance" } } },
        ]),
        Invoice.aggregate([
          { $match: { ...owing, dueOn: { $lt: now } } },
          { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$balance" } } },
        ]),
        Invoice.aggregate([
          { $match: { status: { $ne: "cancelled" }, issuedOn: { $gte: monthStart } } },
          { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$total" } } },
        ]),
        Invoice.aggregate([
          { $unwind: "$payments" },
          { $match: { "payments.receivedOn": { $gte: monthStart } } },
          { $group: { _id: null, amount: { $sum: "$payments.amount" } } },
        ]),
        Invoice.aggregate([
          { $unwind: "$payments" },
          { $match: { "payments.receivedOn": { $gte: yearStart } } },
          { $group: { _id: null, amount: { $sum: "$payments.amount" } } },
        ]),
        Invoice.countDocuments({ status: "draft" }),
      ]);

    const first = (rows) => rows[0] || { count: 0, amount: 0 };

    return res.status(200).json({
      financialYear: financialYear(),
      outstanding: first(outstanding),
      overdue: first(overdueAgg),
      billedThisMonth: first(billedThisMonth),
      receivedThisMonth: first(receivedThisMonth).amount || 0,
      receivedThisYear: first(receivedThisYear).amount || 0,
      drafts,
    });
  } catch (err) {
    console.error("receivables error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
