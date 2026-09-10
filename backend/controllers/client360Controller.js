import ActivityLog from "../models/ActivityLog.js";
import Client from "../models/Client.js";
import FileDoc from "../models/FileDoc.js";
import Invoice from "../models/Invoice.js";
import Issue from "../models/Issue.js";
import Lead from "../models/Lead.js";
import Meeting from "../models/Meeting.js";
import Project from "../models/Project.js";
import Quotation from "../models/Quotation.js";
import Task from "../models/Task.js";
import User from "../models/User.js";

import { logActivity } from "../utils/activity.js";
import { notifyUser } from "../utils/notify.js";

/**
 * One client, seen from every department at once.
 *
 * The panel could already answer each half of this separately — Sales knows
 * the lead and the invoices, Operations knows the projects and the tasks — and
 * nobody could see the join. So the question a director actually asks, "what
 * is going on with this client", meant opening five screens and holding the
 * answer in your head.
 *
 * This is that join, assembled on read from the records themselves. There is
 * no summary document being kept up to date behind it, because a summary
 * document is a thing that goes stale silently.
 */

const projectFields = "name code status priority progress budget startDate endDate";

/* ------------------------------------------------------------- the timeline */

/**
 * Everything that happened, from every department, in one ordered list.
 *
 * Built from the records rather than an event log, so it covers work done
 * before this screen existed — a timeline that starts the day it was written
 * is a timeline nobody trusts.
 */
const buildTimeline = ({ client, lead, projects, quotations, invoices, meetings }) => {
  const events = [];

  const push = (at, department, type, title, detail = "") => {
    if (!at) return;
    events.push({ at, department, type, title, detail });
  };

  push(client.createdAt, "sales", "client_created", "Client record created");

  if (lead) {
    push(lead.createdAt, "sales", "lead_created", `Lead created — ${lead.source || "source not set"}`,
      lead.requirement || "");

    (lead.notes || []).forEach((note) =>
      push(note.at, "sales", "lead_note", `Note by ${note.byName || "someone"}`, note.body)
    );

    push(lead.wonAt, "sales", "lead_won", "Deal won",
      lead.estimatedValue ? `Estimated value ₹${lead.estimatedValue.toLocaleString("en-IN")}` : "");
    push(lead.lostAt, "sales", "lead_lost", "Marked lost", lead.lostReason || "");
  }

  quotations.forEach((quote) =>
    push(quote.createdAt, "sales", "quotation",
      `Quotation ${quote.number || ""} — ${quote.status || "draft"}`,
      quote.total ? `₹${Number(quote.total).toLocaleString("en-IN")}` : "")
  );

  invoices.forEach((invoice) => {
    push(invoice.createdAt, "sales", "invoice",
      `Invoice ${invoice.number || ""} — ${invoice.status || "draft"}`,
      invoice.total ? `₹${Number(invoice.total).toLocaleString("en-IN")}` : "");

    (invoice.payments || []).forEach((payment) =>
      push(payment.receivedOn || payment.date || invoice.updatedAt, "sales", "payment",
        "Payment received",
        payment.amount ? `₹${Number(payment.amount).toLocaleString("en-IN")}` : "")
    );
  });

  push(client.handedOverAt, "operations", "handover", "Handed over to Operations",
    client.handoverNote || "");

  projects.forEach((project) => {
    push(project.createdAt, "operations", "project_started",
      `Project started — ${project.name}`, project.code || "");

    if (project.status === "completed") {
      push(project.endDate || project.updatedAt, "operations", "project_delivered",
        `Project delivered — ${project.name}`);
    }
  });

  meetings.forEach((meeting) =>
    push(meeting.scheduledAt || meeting.createdAt, "operations", "meeting",
      meeting.title || "Meeting", meeting.status || "")
  );

  return events.sort((a, b) => new Date(b.at) - new Date(a.at));
};

/* -------------------------------------------------------------- the view */

/**
 * GET /api/admin/clients/:id/360
 *
 * Everything about one client: where they came from, what was sold, what is
 * being built, who is on it, and what is still owed.
 */
export const client360 = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id)
      .populate("owner", "name email role designation")
      .populate("accountManager", "name email role designation")
      .populate("handedOverBy", "name role")
      // Work we already did for them, answered once when the client was added
      .populate("previousProject", "name code status progress endDate");

    if (!client) return res.status(404).json({ message: "Client not found" });

    /**
     * The lead this client came from.
     *
     * `sourceLead` is the link, and it is only on clients converted since it
     * existed. For everything converted before that, the lead's own
     * `convertedClient` still points here — so both are asked, and the record
     * is found either way rather than older clients silently having no history.
     */
    const leadQuery = client.sourceLead
      ? Lead.findById(client.sourceLead)
      : Lead.findOne({ convertedClient: client._id });

    const [lead, projects, quotations, invoices, files, meetings] = await Promise.all([
      leadQuery.populate("owner", "name email"),
      Project.find({ client: client._id })
        .select(`${projectFields} operationsManager members previousProject`)
        .populate("operationsManager", "name email designation")
        .populate("members", "name designation role")
        .populate("previousProject", "name code")
        .sort({ createdAt: -1 }),
      Quotation.find({ client: client._id }).sort({ createdAt: -1 }),
      Invoice.find({ client: client._id }).sort({ createdAt: -1 }),
      FileDoc.find({ client: client._id })
        .select("title category fileType createdAt project")
        .populate("project", "name code")
        .sort({ createdAt: -1 })
        .limit(20),
      Meeting.find({ client: client._id }).sort({ createdAt: -1 }).limit(20),
    ]);

    const projectIds = projects.map((project) => project._id);

    const [taskRows, issueRows, activity] = await Promise.all([
      Task.aggregate([
        { $match: { project: { $in: projectIds } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Issue.aggregate([
        { $match: { project: { $in: projectIds } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      /**
       * The audit trail for this client and everything belonging to it. The
       * log stores one id per row rather than a client reference, so the set
       * of ids is assembled here — which is what makes "a task on their
       * project was reassigned" show up on the client's own page.
       */
      ActivityLog.find({
        entityId: { $in: [client._id, ...projectIds, ...(lead ? [lead._id] : [])] },
      })
        .sort({ createdAt: -1 })
        .limit(40),
    ]);

    const tasks = {};
    taskRows.forEach((row) => {
      tasks[row._id] = row.count;
    });
    const tasksTotal = Object.values(tasks).reduce((sum, n) => sum + n, 0);

    const issues = {};
    issueRows.forEach((row) => {
      issues[row._id] = row.count;
    });

    /* ---------------------------------------------------------- the money */

    /**
     * `amountPaid` and `balance` are kept in sync with the payment rows by the
     * Invoice model's own pre-save hook, and the receivables report already
     * totals by them. Re-adding the payments here would be a second way of
     * computing the same figure, and two ways is how two answers happen.
     *
     * Cancelled invoices are money that was never owed, so they are left out
     * of both sides rather than counted as an outstanding balance forever.
     */
    const live = invoices.filter((invoice) => invoice.status !== "cancelled");

    const invoiced = live.reduce((sum, invoice) => sum + (invoice.total || 0), 0);
    const received = live.reduce((sum, invoice) => sum + (invoice.amountPaid || 0), 0);

    /* ------------------------------------------------------ who is on it */

    const teamById = new Map();
    projects.forEach((project) => {
      if (project.operationsManager) teamById.set(String(project.operationsManager._id), project.operationsManager);
      (project.members || []).forEach((member) => teamById.set(String(member._id), member));
    });

    const item = client.toObject();
    delete item.password;

    return res.status(200).json({
      client: item,

      sales: {
        lead: lead || null,
        owner: client.owner || lead?.owner || null,
        quotations,
        invoices,
        money: {
          invoiced,
          received,
          outstanding: Math.round(Math.max(0, invoiced - received) * 100) / 100,
          quoted: quotations.reduce((sum, quote) => sum + (quote.total || 0), 0),
          estimatedValue: lead?.estimatedValue || 0,
        },
      },

      handover: {
        done: Boolean(client.handedOverAt),
        at: client.handedOverAt || null,
        by: client.handedOverBy || null,
        note: client.handoverNote || "",
        accountManager: client.accountManager || null,
      },

      operations: {
        projects,
        team: [...teamById.values()],
        tasks: {
          ...tasks,
          total: tasksTotal,
          completed: tasks.completed || 0,
          pending: (tasks.pending || 0) + (tasks.in_progress || 0),
          inReview: tasks.review || 0,
        },
        issues: {
          ...issues,
          open: (issues.open || 0) + (issues.in_progress || 0),
        },
        progress: projects.length
          ? Math.round(
              projects.reduce((sum, project) => sum + (project.progress || 0), 0) / projects.length
            )
          : 0,
      },

      files,
      meetings,
      activity,

      timeline: buildTimeline({ client, lead, projects, quotations, invoices, meetings }),

      stats: {
        projects: projects.length,
        projectsActive: projects.filter((p) => p.status === "in_progress").length,
        projectsCompleted: projects.filter((p) => p.status === "completed").length,
        budget: projects.reduce((sum, project) => sum + (project.budget || 0), 0),
        teamSize: teamById.size,
        files: files.length,
        since: client.createdAt,
      },
    });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Client not found" });
    console.error("client360 error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/admin/clients/:id/handover   { accountManager, note }
 *
 * Sales is done; Operations picks it up.
 *
 * A deal that is won and a project that has started are two different days,
 * and the gap between them is where clients get dropped. Recording the moment
 * — and who took it on — is what turns "somebody will pick that up" into a
 * name on a record.
 */
export const handOverClient = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ message: "Client not found" });

    const managerId = req.body.accountManager;
    if (!managerId) {
      return res.status(400).json({ message: "Choose who in Operations is taking this on" });
    }

    const manager = await User.findById(managerId).select("name role status");
    if (!manager) return res.status(400).json({ message: "That person is not on the system" });
    if (manager.status !== "active") {
      return res.status(400).json({ message: `${manager.name}'s account is inactive` });
    }

    const reassigning = Boolean(client.handedOverAt);

    client.accountManager = manager._id;
    client.handedOverAt = client.handedOverAt || new Date();
    client.handedOverBy = req.admin?._id;
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
      client,
    });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Client not found" });
    console.error("handOverClient error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/admin/clients/pending-handover
 *
 * Won, and not yet picked up by anybody. The list that stops a closed deal
 * sitting between two departments for three weeks.
 */
export const pendingHandover = async (req, res) => {
  try {
    const clients = await Client.find({
      status: { $ne: "inactive" },
      handedOverAt: { $exists: false },
    })
      .select("name company email phone createdAt sourceLead owner status")
      .populate("owner", "name")
      .populate("sourceLead", "name stage wonAt estimatedValue")
      .sort({ createdAt: -1 })
      .limit(100);

    /**
     * A client with no project is the one actually at risk. One that has a
     * project running is being worked on whether or not anybody filled the
     * handover in, so it is reported separately rather than alarmingly.
     */
    const withProjects = new Set(
      (
        await Project.find({ client: { $in: clients.map((c) => c._id) } }).distinct("client")
      ).map(String)
    );

    return res.status(200).json({
      items: clients.map((client) => ({
        ...client.toObject(),
        hasProject: withProjects.has(String(client._id)),
      })),
      total: clients.length,
      unstarted: clients.filter((client) => !withProjects.has(String(client._id))).length,
    });
  } catch (err) {
    console.error("pendingHandover error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
