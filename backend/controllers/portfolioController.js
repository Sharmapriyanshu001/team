import mongoose from "mongoose";

import Property from "../models/Property.js";
import PropertyEntry from "../models/PropertyEntry.js";
import AdCampaign from "../models/AdCampaign.js";

import { buildCrud, InvalidInput } from "../utils/crud.js";
import { logActivity } from "../utils/activity.js";

/**
 * The studio's own apps and sites: what each one made, what it cost, and who
 * that money belongs to.
 *
 * Everything else in this panel answers "has the client paid". This answers
 * "did we make anything", which is a different question and the only one that
 * matters about work nobody commissioned.
 */

/* ------------------------------------------------------------------ helpers */

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

const startOfDay = (value) => {
  const plain = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
  if (plain) {
    const [year, month, day] = String(value).trim().split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  return date;
};

/** The window a report covers. Defaults to the month that is running. */
const readRange = (query = {}) => {
  const now = new Date();

  const from = query.from
    ? new Date(new Date(startOfDay(query.from)).setHours(0, 0, 0, 0))
    : new Date(now.getFullYear(), now.getMonth(), 1);

  const to = query.to
    ? new Date(new Date(startOfDay(query.to)).setHours(23, 59, 59, 999))
    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  return { from, to };
};

/**
 * What the linked ad accounts spent on this property in a period.
 *
 * Read from the ads module rather than re-entered here, so promoting an owned
 * app is counted once. Typing it again as an expense is how a property comes
 * out looking twice as unprofitable as it is — and the person who notices is
 * usually the partner being told there is nothing to pay them.
 */
const linkedAdSpend = async (property, from, to) => {
  /**
   * The ids arrive either raw or as populated documents depending on which
   * screen asked, so the id is taken off whichever this is. Passing a
   * populated document to the ObjectId constructor throws, and the screen that
   * populates is the single-property one — the exact place a wrong figure
   * would be trusted.
   */
  const accounts = (property.adAccounts || [])
    .map((entry) => (entry && entry._id) || entry)
    .filter(Boolean);

  if (!accounts.length) return 0;

  const [row] = await AdCampaign.aggregate([
    { $match: { adAccount: { $in: accounts.map((id) => new mongoose.Types.ObjectId(String(id))) } } },
    { $unwind: "$daily" },
    { $match: { "daily.date": { $gte: from, $lte: to } } },
    { $group: { _id: null, spend: { $sum: "$daily.spend" } } },
  ]);

  return round(row?.spend);
};

/** Sum a property's entries over a window, grouped however the caller asks. */
const sumEntries = async (propertyId, from, to, extra = {}) => {
  const rows = await PropertyEntry.aggregate([
    {
      $match: {
        property: new mongoose.Types.ObjectId(String(propertyId)),
        on: { $gte: from, $lte: to },
        ...extra,
      },
    },
    {
      $group: {
        _id: { kind: "$kind", category: "$category" },
        total: { $sum: "$baseAmount" },
        settled: {
          $sum: { $cond: [{ $ne: ["$settledOn", null] }, "$baseAmount", 0] },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  return rows.map((row) => ({
    kind: row._id.kind,
    category: row._id.category,
    total: round(row.total),
    settled: round(row.settled),
    count: row.count,
  }));
};

/**
 * What each partner has been paid on this property, ever.
 *
 * Deliberately not scoped to the reporting window. A share is earned in a
 * month but settled whenever there is cash, so comparing one month's share
 * against one month's payments would show everybody as permanently owed.
 */
const paidToPartners = async (propertyId) => {
  const rows = await PropertyEntry.aggregate([
    {
      $match: {
        property: new mongoose.Types.ObjectId(String(propertyId)),
        kind: "payout",
      },
    },
    { $group: { _id: "$partner", paid: { $sum: "$baseAmount" } } },
  ]);

  return new Map(rows.map((row) => [String(row._id), round(row.paid)]));
};

/**
 * The whole picture for one property over one window.
 *
 * Returned as a plain object rather than a response so the portfolio screen
 * can build the same figures for every property without a round trip each.
 */
const profitAndLoss = async (property, from, to) => {
  /**
   * Payments to partners are counted over all time, not over the window.
   *
   * A share is earned in a month and settled whenever there is cash to settle
   * it with, so measuring one month's share against one month's payments would
   * show every partner as permanently owed. What somebody is owed is the whole
   * of what they have earned, less the whole of what they have had.
   */
  const [grouped, adSpend, paid] = await Promise.all([
    sumEntries(property._id, from, to),
    linkedAdSpend(property, from, to),
    paidToPartners(property._id),
  ]);

  const revenueRows = grouped.filter((row) => row.kind === "revenue");
  const expenseRows = grouped.filter((row) => row.kind === "expense");

  const earned = round(revenueRows.reduce((sum, row) => sum + row.total, 0));
  const received = round(revenueRows.reduce((sum, row) => sum + row.settled, 0));

  const typedExpenses = round(expenseRows.reduce((sum, row) => sum + row.total, 0));
  const spent = round(typedExpenses + adSpend);

  const profit = round(earned - spent);

  /**
   * Each partner's position.
   *
   * Two deals exist and they differ exactly here: a partner who shares costs
   * takes a slice of the profit, one who does not takes a slice of the revenue
   * and leaves the costs to the studio. Both are common, so both are computed
   * from the flag rather than from an assumption about which one is normal.
   *
   * The studio's own take is the residual — whatever is left once the partners
   * have taken theirs. That stays correct however the two kinds are mixed,
   * which a stored percentage would not.
   */
  const partners = (property.partners || [])
    .filter((partner) => partner.active)
    .map((partner) => {
      const base = partner.sharesCosts ? profit : earned;
      const share = round((base * (partner.sharePercent || 0)) / 100);
      const already = paid.get(String(partner._id)) || 0;

      return {
        _id: partner._id,
        name: partner.name,
        sharePercent: partner.sharePercent,
        sharesCosts: partner.sharesCosts,
        shareOf: partner.sharesCosts ? "profit" : "revenue",
        share,
        paid: already,
        owed: round(share - already),
      };
    });

  return {
    revenue: { earned, received, pending: round(earned - received), byCategory: revenueRows },
    expenses: {
      total: spent,
      entered: typedExpenses,
      linkedAdSpend: adSpend,
      byCategory: expenseRows,
    },
    profit,
    margin: earned ? round((profit / earned) * 100) : null,
    partners,
    studio: {
      sharePercent: property.studioShare(),
      take: round(profit - partners.reduce((sum, partner) => sum + partner.share, 0)),
    },
  };
};

/* ------------------------------------------------------------- properties */

export const properties = buildCrud(Property, {
  entity: "Property",
  searchFields: ["name", "handle", "url"],
  filterFields: ["kind", "status"],
  populate: [
    { path: "publishedApp", select: "name packageName status" },
    { path: "adAccounts", select: "name platform" },
  ],
  sort: { status: 1, name: 1 },

  beforeSave: (payload, req, existing) => {
    const data = { ...payload };

    if (data.partners !== undefined) {
      const given = (Array.isArray(data.partners) ? data.partners : [])
        .filter((partner) => partner && partner.active !== false)
        .reduce((sum, partner) => sum + (Number(partner.sharePercent) || 0), 0);

      /**
       * Above 100 is refused; below is not. Partners holding 70% means the
       * studio keeps 30, which is an ordinary deal — but partners holding 130%
       * is somebody having typed a number twice, and every payout after it
       * would be wrong.
       */
      if (given > 100) {
        throw new InvalidInput(
          `Those shares add up to ${round(given)}% — more than the whole thing`
        );
      }
    }

    if (!existing) data.createdBy = req.admin?._id;

    return data;
  },
});

/** One property, with its books for the window asked for. */
export const propertyDetail = async (req, res) => {
  try {
    const property = await Property.findById(req.params.id)
      .populate("publishedApp", "name packageName status liveVersionName")
      .populate("adAccounts", "name platform monthlyBudget");

    if (!property) return res.status(404).json({ message: "Property not found" });

    const { from, to } = readRange(req.query);

    const [pnl, recent] = await Promise.all([
      profitAndLoss(property, from, to),
      PropertyEntry.find({ property: property._id }).sort({ on: -1 }).limit(50),
    ]);

    return res.status(200).json({
      item: property,
      period: { from, to },
      pnl,
      entries: recent,
    });
  } catch (err) {
    console.error("propertyDetail error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------------- entries */

const normaliseEntry = (body, property, actor) => {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new InvalidInput("Enter an amount above zero");
  }

  if (!body.on) throw new InvalidInput("Which month or day is this for?");
  if (!body.category) throw new InvalidInput("Pick a category");

  const currency = String(body.currency || property.baseCurrency || "INR").toUpperCase();
  const fxRate = currency === property.baseCurrency ? 1 : Number(body.fxRate);

  /**
   * A foreign amount with no rate cannot be added to anything. Refused rather
   * than defaulted to 1 — a dollar counted as a rupee understates the takings
   * by a factor of eighty, and nothing about the total would look wrong enough
   * to notice.
   */
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    throw new InvalidInput(
      `Give the rate you were paid at — what one ${currency} was worth in ${property.baseCurrency}`
    );
  }

  return {
    property: property._id,
    kind: body.kind,
    category: body.category,
    amount,
    currency,
    fxRate,
    baseAmount: round(amount * fxRate),
    on: startOfDay(body.on),
    settledOn: body.settledOn ? startOfDay(body.settledOn) : null,
    reference: body.reference || "",
    note: body.note || "",
    createdBy: actor?._id,
    createdByName: actor?.name || "",
  };
};

export const listEntries = async (req, res) => {
  try {
    const query = { property: req.params.id };
    if (req.query.kind && req.query.kind !== "all") query.kind = req.query.kind;

    if (req.query.from || req.query.to) {
      const { from, to } = readRange(req.query);
      query.on = { $gte: from, $lte: to };
    }

    const entries = await PropertyEntry.find(query).sort({ on: -1 }).limit(500);
    return res.status(200).json({ items: entries });
  } catch (err) {
    console.error("listEntries error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const addEntry = async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) return res.status(404).json({ message: "Property not found" });

    if (!["revenue", "expense"].includes(req.body.kind)) {
      return res.status(400).json({
        message: "That is not a revenue or expense line — pay a partner from the partners section",
      });
    }

    const entry = await PropertyEntry.create(normaliseEntry(req.body, property, req.admin));

    logActivity(req, {
      action: "created",
      entity: "Property entry",
      entityId: entry._id,
      message: `${property.name}: ${entry.kind} ${entry.baseAmount} (${entry.category})`,
    });

    return res.status(201).json({ message: "Recorded", item: entry });
  } catch (err) {
    if (err.name === "InvalidInput") return res.status(400).json({ message: err.message });
    console.error("addEntry error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateEntry = async (req, res) => {
  try {
    const entry = await PropertyEntry.findById(req.params.entryId);
    if (!entry) return res.status(404).json({ message: "Entry not found" });

    const property = await Property.findById(entry.property);

    if (req.body.amount !== undefined || req.body.fxRate !== undefined) {
      const amount = Number(req.body.amount ?? entry.amount);
      const fxRate = Number(req.body.fxRate ?? entry.fxRate);
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(fxRate) || fxRate <= 0) {
        return res.status(400).json({ message: "Amount and rate must both be above zero" });
      }
      entry.amount = amount;
      entry.fxRate = fxRate;
      entry.baseAmount = round(amount * fxRate);
    }

    ["category", "reference", "note", "currency"].forEach((field) => {
      if (req.body[field] !== undefined) entry[field] = req.body[field];
    });

    if (req.body.on !== undefined) entry.on = startOfDay(req.body.on);

    /**
     * Marking money as arrived is the commonest edit here — AdMob reports a
     * month in the first week and pays it in the last, so an entry is created
     * unsettled and settled weeks later.
     */
    if (req.body.settledOn !== undefined) {
      entry.settledOn = req.body.settledOn ? startOfDay(req.body.settledOn) : null;
    }

    await entry.save();

    return res.status(200).json({
      message: "Updated",
      item: entry,
      property: property?.name,
    });
  } catch (err) {
    console.error("updateEntry error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const removeEntry = async (req, res) => {
  try {
    const entry = await PropertyEntry.findByIdAndDelete(req.params.entryId);
    if (!entry) return res.status(404).json({ message: "Entry not found" });

    logActivity(req, {
      action: "deleted",
      entity: "Property entry",
      entityId: entry._id,
      message: `A ${entry.kind} line of ${entry.baseAmount} was deleted`,
    });

    return res.status(200).json({ message: "Deleted" });
  } catch (err) {
    console.error("removeEntry error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- partners */

/** Pay a partner their share, or part of it. */
export const payPartner = async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) return res.status(404).json({ message: "Property not found" });

    const partner = property.partners.id(req.params.partnerId);
    if (!partner) return res.status(404).json({ message: "That partner is not on this property" });

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Enter the amount paid" });
    }

    const entry = await PropertyEntry.create({
      property: property._id,
      kind: "payout",
      category: "partner_payout",
      amount,
      currency: property.baseCurrency,
      fxRate: 1,
      baseAmount: round(amount),
      on: req.body.on ? startOfDay(req.body.on) : new Date(),
      // A payout is recorded when it happens, so it is settled by definition
      settledOn: req.body.on ? startOfDay(req.body.on) : new Date(),
      partner: partner._id,
      partnerName: partner.name,
      reference: req.body.reference || "",
      note: req.body.note || "",
      createdBy: req.admin?._id,
      createdByName: req.admin?.name || "",
    });

    logActivity(req, {
      action: "created",
      entity: "Property entry",
      entityId: entry._id,
      message: `${property.name}: paid ${partner.name} ${amount}`,
    });

    return res.status(201).json({ message: `Paid ${partner.name}`, item: entry });
  } catch (err) {
    console.error("payPartner error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** Every payout made on this property, newest first. */
export const listPayouts = async (req, res) => {
  try {
    const payouts = await PropertyEntry.find({ property: req.params.id, kind: "payout" }).sort({
      on: -1,
    });
    return res.status(200).json({ items: payouts });
  } catch (err) {
    console.error("listPayouts error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- portfolio */

/**
 * Every property, side by side, for one window.
 *
 * The screen this is for answers one question — which of these is worth
 * carrying on with — so it leads with profit rather than revenue. An app
 * making forty thousand a month and spending forty-two is not a success with
 * a cost problem; it is a loss.
 */
export const portfolio = async (req, res) => {
  try {
    const { from, to } = readRange(req.query);
    const all = await Property.find({ status: { $ne: "retired" } }).sort({ name: 1 });

    const rows = await Promise.all(
      all.map(async (property) => {
        const pnl = await profitAndLoss(property, from, to);

        const owedToPartners = pnl.partners.reduce(
          (sum, partner) => sum + Math.max(0, partner.owed),
          0
        );

        return {
          _id: property._id,
          name: property.name,
          kind: property.kind,
          status: property.status,
          handle: property.handle,
          partnerCount: (property.partners || []).filter((p) => p.active).length,
          revenue: pnl.revenue.earned,
          received: pnl.revenue.received,
          pending: pnl.revenue.pending,
          adSpend: pnl.expenses.linkedAdSpend,
          expenses: pnl.expenses.total,
          profit: pnl.profit,
          margin: pnl.margin,
          studioTake: pnl.studio.take,
          owedToPartners: round(owedToPartners),
        };
      })
    );

    const totals = rows.reduce(
      (acc, row) => ({
        revenue: round(acc.revenue + row.revenue),
        received: round(acc.received + row.received),
        pending: round(acc.pending + row.pending),
        expenses: round(acc.expenses + row.expenses),
        profit: round(acc.profit + row.profit),
        studioTake: round(acc.studioTake + row.studioTake),
        owedToPartners: round(acc.owedToPartners + row.owedToPartners),
      }),
      { revenue: 0, received: 0, pending: 0, expenses: 0, profit: 0, studioTake: 0, owedToPartners: 0 }
    );

    const ranked = [...rows].sort((a, b) => b.profit - a.profit);

    return res.status(200).json({
      period: { from, to },
      properties: rows,
      totals,
      best: ranked.slice(0, 3),
      losing: ranked.filter((row) => row.profit < 0).reverse(),
    });
  } catch (err) {
    console.error("portfolio error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * A property's month-by-month history — the shape a decision is actually made
 * from. One month of loss is a bad month; six is an answer.
 */
export const propertyHistory = async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) return res.status(404).json({ message: "Property not found" });

    const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 12));
    const now = new Date();

    const series = [];
    for (let back = months - 1; back >= 0; back--) {
      const from = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const to = new Date(now.getFullYear(), now.getMonth() - back + 1, 0, 23, 59, 59, 999);

      // eslint-disable-next-line no-await-in-loop
      const pnl = await profitAndLoss(property, from, to);

      series.push({
        month: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`,
        revenue: pnl.revenue.earned,
        expenses: pnl.expenses.total,
        profit: pnl.profit,
      });
    }

    return res.status(200).json({ property: { _id: property._id, name: property.name }, series });
  } catch (err) {
    console.error("propertyHistory error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
