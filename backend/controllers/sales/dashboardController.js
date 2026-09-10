import Client from "../../models/Client.js";
import FollowUp from "../../models/FollowUp.js";
import Invoice from "../../models/Invoice.js";
import Lead, { LEAD_SOURCES, LEAD_STAGES } from "../../models/Lead.js";
import Quotation from "../../models/Quotation.js";
import SalesActivity from "../../models/SalesActivity.js";
import User, { SALES_PANEL_ROLES } from "../../models/User.js";

/**
 * The Sales dashboard and reports.
 *
 * Every number here is counted from the collections on read rather than stored
 * anywhere, so none of it can drift from the rows it summarises. That costs a
 * handful of aggregations per page load and buys a dashboard nobody has to
 * distrust.
 *
 * All of it is scoped: an executive's dashboard is their own pipeline, a
 * head's is the floor's. Same fragment as everywhere else in this panel.
 */

const startOfDay = (d = new Date()) => new Date(new Date(d).setHours(0, 0, 0, 0));
const endOfDay = (d = new Date()) => new Date(new Date(d).setHours(23, 59, 59, 999));

const monthRange = (year, month) => ({
  from: new Date(year, month - 1, 1),
  to: new Date(year, month, 0, 23, 59, 59, 999),
});

/* ------------------------------------------------------------ dashboard */

// GET /api/sales/dashboard
export const salesDashboard = async (req, res) => {
  try {
    const scope = req.salesScope;
    const now = new Date();
    const today = startOfDay();
    const tonight = endOfDay();

    const { from: monthFrom, to: monthTo } = monthRange(
      Number(req.query.year) || now.getFullYear(),
      Number(req.query.month) || now.getMonth() + 1
    );

    /** Follow-ups are scoped by the lead/client they hang off. */
    const followScope = scope.isSalesHead
      ? {}
      : { $or: [{ lead: { $in: await Lead.find(scope.lead).distinct("_id") } }, { assignedTo: scope.userId }] };

    const [
      stageRows,
      overdue,
      dueToday,
      wonThisMonth,
      lostThisMonth,
      newThisMonth,
      activitiesThisMonth,
      clientsAwaiting,
      recentLeads,
      upcoming,
    ] = await Promise.all([
      Lead.aggregate([
        { $match: { ...scope.lead } },
        {
          $group: {
            _id: "$stage",
            count: { $sum: 1 },
            value: { $sum: { $ifNull: ["$estimatedValue", 0] } },
          },
        },
      ]),
      FollowUp.countDocuments({ ...followScope, status: "pending", dueOn: { $lt: today } }),
      FollowUp.countDocuments({
        ...followScope,
        status: "pending",
        dueOn: { $gte: today, $lte: tonight },
      }),
      Lead.find({ ...scope.lead, stage: "won", wonAt: { $gte: monthFrom, $lte: monthTo } }).select(
        "estimatedValue"
      ),
      Lead.countDocuments({
        ...scope.lead,
        stage: "lost",
        lostAt: { $gte: monthFrom, $lte: monthTo },
      }),
      Lead.countDocuments({ ...scope.lead, createdAt: { $gte: monthFrom, $lte: monthTo } }),
      SalesActivity.countDocuments({
        ...(scope.isSalesHead ? {} : { by: scope.userId }),
        occurredAt: { $gte: monthFrom, $lte: monthTo },
      }),
      Client.countDocuments({
        ...scope.client,
        status: { $ne: "lead" },
        handedOverAt: { $exists: false },
      }),
      Lead.find({ ...scope.lead })
        .populate("owner", "name")
        .sort({ createdAt: -1 })
        .limit(8)
        .select("name company stage estimatedValue source createdAt owner"),
      FollowUp.find({ ...followScope, status: "pending" })
        .populate("lead", "name company")
        .populate("client", "name company")
        .sort({ dueOn: 1 })
        .limit(8),
    ]);

    const byStage = {};
    LEAD_STAGES.forEach((s) => {
      byStage[s] = { stage: s, count: 0, value: 0 };
    });
    stageRows.forEach((r) => {
      byStage[r._id] = { stage: r._id, count: r.count, value: r.value };
    });

    const openStages = LEAD_STAGES.filter((s) => !["won", "lost"].includes(s));
    const openPipeline = openStages.reduce(
      (acc, s) => {
        acc.count += byStage[s].count;
        acc.value += byStage[s].value;
        return acc;
      },
      { count: 0, value: 0 }
    );

    const wonCount = wonThisMonth.length;
    const wonValue = wonThisMonth.reduce((sum, l) => sum + (l.estimatedValue || 0), 0);
    const decided = wonCount + lostThisMonth;

    return res.status(200).json({
      scope: scope.isSalesHead ? "team" : "own",
      month: `${monthFrom.getFullYear()}-${String(monthFrom.getMonth() + 1).padStart(2, "0")}`,
      pipeline: { stages: LEAD_STAGES.map((s) => byStage[s]), open: openPipeline },
      thisMonth: {
        newLeads: newThisMonth,
        won: wonCount,
        wonValue,
        lost: lostThisMonth,
        activities: activitiesThisMonth,
        // Of the deals actually decided this month
        conversionRate: decided ? Math.round((wonCount / decided) * 100) : 0,
      },
      followUps: { overdue, dueToday },
      clientsAwaitingHandover: clientsAwaiting,
      recentLeads,
      upcomingFollowUps: upcoming,
    });
  } catch (err) {
    console.error("salesDashboard error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- reports */

/**
 * GET /api/sales/reports?year=&month=
 *
 * Conversion, sources, team performance and the money — the four questions a
 * sales review asks, in one response so the page is not four spinners.
 */
export const salesReports = async (req, res) => {
  try {
    const scope = req.salesScope;
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const { from, to } = monthRange(year, month);

    const [sources, monthly, teamRows, lostRows, quotations, invoices] = await Promise.all([
      Lead.aggregate([
        { $match: { ...scope.lead } },
        {
          $group: {
            _id: "$source",
            total: { $sum: 1 },
            won: { $sum: { $cond: [{ $eq: ["$stage", "won"] }, 1, 0] } },
            lost: { $sum: { $cond: [{ $eq: ["$stage", "lost"] }, 1, 0] } },
            value: { $sum: { $ifNull: ["$estimatedValue", 0] } },
          },
        },
      ]),

      /** Twelve months of created / won / lost, for the trend line. */
      Lead.aggregate([
        {
          $match: {
            ...scope.lead,
            createdAt: { $gte: new Date(year - 1, month - 1, 1) },
          },
        },
        {
          $group: {
            _id: { y: { $year: "$createdAt" }, m: { $month: "$createdAt" } },
            created: { $sum: 1 },
            won: { $sum: { $cond: [{ $eq: ["$stage", "won"] }, 1, 0] } },
            lost: { $sum: { $cond: [{ $eq: ["$stage", "lost"] }, 1, 0] } },
            value: {
              $sum: { $cond: [{ $eq: ["$stage", "won"] }, { $ifNull: ["$estimatedValue", 0] }, 0] },
            },
          },
        },
        { $sort: { "_id.y": 1, "_id.m": 1 } },
      ]),

      /** Per-person performance. A head sees everybody; an executive, themselves. */
      Lead.aggregate([
        { $match: { ...scope.lead, owner: { $ne: null } } },
        {
          $group: {
            _id: "$owner",
            leads: { $sum: 1 },
            won: { $sum: { $cond: [{ $eq: ["$stage", "won"] }, 1, 0] } },
            lost: { $sum: { $cond: [{ $eq: ["$stage", "lost"] }, 1, 0] } },
            wonValue: {
              $sum: { $cond: [{ $eq: ["$stage", "won"] }, { $ifNull: ["$estimatedValue", 0] }, 0] },
            },
            openValue: {
              $sum: {
                $cond: [
                  { $in: ["$stage", ["won", "lost"]] },
                  0,
                  { $ifNull: ["$estimatedValue", 0] },
                ],
              },
            },
          },
        },
        { $sort: { wonValue: -1 } },
      ]),

      Lead.aggregate([
        { $match: { ...scope.lead, stage: "lost" } },
        {
          $group: {
            _id: { $toLower: { $ifNull: ["$lostReason", "not given"] } },
            count: { $sum: 1 },
            value: { $sum: { $ifNull: ["$estimatedValue", 0] } },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 15 },
      ]),

      Quotation.countDocuments({ createdAt: { $gte: from, $lte: to } }),

      /**
       * Revenue is read from the invoices rather than from won-deal estimates:
       * an estimate is what somebody hoped for, and a payment is what arrived.
       */
      Invoice.find({ createdAt: { $gte: from, $lte: to } }).select("total payments status"),
    ]);

    const people = await User.find({ role: { $in: SALES_PANEL_ROLES } }).select("name role");
    const nameOf = {};
    people.forEach((p) => {
      nameOf[String(p._id)] = { name: p.name, role: p.role };
    });

    const bySource = {};
    sources.forEach((s) => {
      bySource[s._id] = s;
    });

    const billed = invoices.reduce((sum, i) => sum + (i.total || 0), 0);
    const received = invoices.reduce(
      (sum, i) => sum + (i.payments || []).reduce((p, pay) => p + (pay.amount || 0), 0),
      0
    );

    return res.status(200).json({
      month: `${year}-${String(month).padStart(2, "0")}`,
      scope: scope.isSalesHead ? "team" : "own",

      sources: LEAD_SOURCES.map((source) => {
        const r = bySource[source] || {};
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

      monthly: monthly.map((m) => ({
        month: `${m._id.y}-${String(m._id.m).padStart(2, "0")}`,
        created: m.created,
        won: m.won,
        lost: m.lost,
        wonValue: m.value,
      })),

      team: teamRows.map((t) => {
        const decided = t.won + t.lost;
        return {
          user: nameOf[String(t._id)]?.name || "Unassigned",
          role: nameOf[String(t._id)]?.role || "",
          leads: t.leads,
          won: t.won,
          lost: t.lost,
          wonValue: t.wonValue,
          openValue: t.openValue,
          conversionRate: decided ? Math.round((t.won / decided) * 100) : 0,
        };
      }),

      lostReasons: lostRows.map((r) => ({
        reason: r._id || "not given",
        count: r.count,
        value: r.value,
      })),

      money: { quotationsRaised: quotations, billed, received, outstanding: billed - received },
    });
  } catch (err) {
    console.error("salesReports error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/sales/revenue
 *
 * What has been invoiced and what has actually arrived, per client.
 * Read-only for an executive; the head can see the whole book.
 */
export const salesRevenue = async (req, res) => {
  try {
    const clientIds = await Client.find(req.salesScope.client).distinct("_id");
    const query = req.salesScope.isSalesHead ? {} : { client: { $in: clientIds } };

    const invoices = await Invoice.find(query)
      .populate("client", "name company")
      .sort({ createdAt: -1 })
      .limit(300);

    const rows = invoices.map((inv) => {
      const paid = (inv.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
      return {
        _id: inv._id,
        number: inv.number || inv.invoiceNumber || "",
        client: inv.client,
        total: inv.total || 0,
        paid,
        outstanding: (inv.total || 0) - paid,
        status: inv.status,
        createdAt: inv.createdAt,
        dueDate: inv.dueDate,
      };
    });

    const totals = rows.reduce(
      (acc, r) => {
        acc.billed += r.total;
        acc.received += r.paid;
        acc.outstanding += r.outstanding;
        return acc;
      },
      { billed: 0, received: 0, outstanding: 0 }
    );

    return res.status(200).json({ items: rows, totals });
  } catch (err) {
    console.error("salesRevenue error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
