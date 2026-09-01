import AdAccount from "../models/AdAccount.js";
import AdCampaign from "../models/AdCampaign.js";
import Client from "../models/Client.js";

import { buildCrud, InvalidInput } from "../utils/crud.js";
import { raiseInvoice, settings } from "../utils/invoicing.js";
import { logActivity } from "../utils/activity.js";
import { notifyUsers } from "../utils/notify.js";

/**
 * Paid advertising: the accounts, the campaigns on them, what they spent, and
 * — the part that actually costs money to get wrong — whose money it was.
 */

/* ------------------------------------------------------------------ helpers */

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

const asIdList = (value) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => (entry && entry._id) || entry)
    .filter(Boolean)
    .map(String);

const mergeAssignments = (existingRows = [], userIds = [], actor) => {
  const byUser = new Map(existingRows.map((row) => [String(row.user), row]));
  return userIds.map(
    (id) =>
      byUser.get(String(id)) || {
        user: id,
        assignedBy: actor?._id,
        assignedByName: actor?.name || "",
        assignedByRole: actor?.role || "admin",
        assignedAt: new Date(),
      }
  );
};

const newcomers = (before = [], after = []) => {
  const had = new Set(before.map(String));
  return after.map(String).filter((id) => !had.has(id));
};

/**
 * The calendar day a value names, at local noon.
 *
 * A bare "2026-09-01" is parsed by JavaScript as UTC midnight, which in a
 * timezone behind UTC is the previous afternoon — so a spend row imported as
 * the 1st would be filed on the 31st, and a month's total would be wrong by
 * one day at each end. Date-only strings are therefore read as the calendar
 * date they say, and everything is anchored at noon so no later timezone
 * arithmetic can push a day across a boundary.
 */
const startOfDay = (value) => {
  const plain = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());

  if (plain) {
    const [year, month, day] = value.trim().split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  return date;
};

const monthBounds = (when = new Date()) => {
  const from = new Date(when.getFullYear(), when.getMonth(), 1);
  const to = new Date(when.getFullYear(), when.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
};

/**
 * What an account spent between two dates.
 *
 * The daily rows live inside the campaigns, so this unwinds them — which is
 * why `daily.date` is the thing being matched rather than anything on the
 * campaign itself. A campaign that ran in March and stopped still contributes
 * its March days to a March total.
 */
const spendBetween = async (accountId, from, to) => {
  const [row] = await AdCampaign.aggregate([
    { $match: { adAccount: accountId } },
    { $unwind: "$daily" },
    { $match: { "daily.date": { $gte: from, $lte: to } } },
    {
      $group: {
        _id: null,
        spend: { $sum: "$daily.spend" },
        impressions: { $sum: "$daily.impressions" },
        clicks: { $sum: "$daily.clicks" },
        conversions: { $sum: "$daily.conversions" },
        conversionValue: { $sum: "$daily.conversionValue" },
      },
    },
  ]);

  return {
    spend: round(row?.spend),
    impressions: row?.impressions || 0,
    clicks: row?.clicks || 0,
    conversions: round(row?.conversions),
    conversionValue: round(row?.conversionValue),
  };
};

/** The ratios everybody talks about, derived rather than stored. */
export const derive = (totals) => {
  const { spend, impressions, clicks, conversions, conversionValue } = totals;
  return {
    ...totals,
    ctr: impressions ? round((clicks / impressions) * 100) : null,
    cpc: clicks ? round(spend / clicks) : null,
    cpm: impressions ? round((spend / impressions) * 1000) : null,
    cpa: conversions ? round(spend / conversions) : null,
    roas: spend ? round(conversionValue / spend) : null,
  };
};

/**
 * How the month is going against the budget.
 *
 * The projection is the flat one — spend so far, divided by the days that have
 * gone, times the days in the month. It is not clever and does not try to be:
 * everybody running ads does this arithmetic in their head, and a number they
 * can check is worth more than one they have to trust.
 *
 * Returns null where there is no budget, so the screen shows nothing rather
 * than a confident figure derived from zero.
 */
export const pace = (monthlyBudget, spentThisMonth, when = new Date()) => {
  if (!monthlyBudget) return null;

  const daysInMonth = new Date(when.getFullYear(), when.getMonth() + 1, 0).getDate();
  const dayOfMonth = when.getDate();

  const projected = round((spentThisMonth / dayOfMonth) * daysInMonth);
  const shouldHaveSpent = round((monthlyBudget / daysInMonth) * dayOfMonth);

  return {
    budget: monthlyBudget,
    spent: round(spentThisMonth),
    remaining: round(monthlyBudget - spentThisMonth),
    usedPercent: round((spentThisMonth / monthlyBudget) * 100),
    onPaceFor: projected,
    variance: round(projected - monthlyBudget),
    aheadBy: round(spentThisMonth - shouldHaveSpent),
    dayOfMonth,
    daysInMonth,
  };
};

/**
 * What the studio is owed on this account, and what is left of the client's
 * money. Which of the two is meaningful depends entirely on `funding`.
 */
const moneyPosition = async (account) => {
  /**
   * Both figures below run to the far future rather than to "now".
   *
   * If a day is in the database it was spent, and a row somebody dated wrongly
   * is a mistake that should show up in what is owed rather than be quietly
   * left out of it — under-billing is the exact failure this module exists to
   * prevent.
   */
  const FOREVER = new Date(8640000000000000);

  if (account.funding === "studio_card") {
    const since = account.recoveredTo();
    const from = since ? new Date(since.getTime() + 1) : new Date(0);
    const { spend } = await spendBetween(account._id, from, FOREVER);

    return {
      kind: "recoverable",
      unrecovered: round(spend),
      recoveredTo: since,
      // Spend the studio has fronted and not yet billed for
      note: "Spend the studio has paid for and not yet billed back",
    };
  }

  if (account.funding === "prepaid") {
    const { spend } = await spendBetween(account._id, new Date(0), FOREVER);
    const toppedUp = account.toppedUp();
    const balance = round(toppedUp - spend);

    return {
      kind: "balance",
      toppedUp,
      spentAllTime: round(spend),
      balance,
      // A balance that runs out mid-campaign is the failure this exists to catch
      exhausted: balance <= 0,
    };
  }

  return { kind: "client_card", note: "The client's own card is on this account" };
};

/** The studio's fee for a period, from whatever the account is set to. */
export const feeFor = (account, spend) => {
  if (account.feeType === "percent_of_spend") return round((spend * (account.feeValue || 0)) / 100);
  if (account.feeType === "flat_monthly") return round(account.feeValue || 0);
  return 0;
};

/* -------------------------------------------------------------- accounts */

export const accounts = buildCrud(AdAccount, {
  entity: "Ad account",
  searchFields: ["name", "externalId"],
  filterFields: ["platform", "status", "client", "funding"],
  populate: [
    { path: "client", select: "name company" },
    { path: "teamLeaders", select: "name email" },
    { path: "employees", select: "name email" },
  ],
  sort: { createdAt: -1 },

  beforeSave: (payload, req, existing) => {
    const data = { ...payload };

    if (!data.client && !existing?.client) {
      throw new InvalidInput("Pick the client this ad account belongs to");
    }

    /**
     * A percentage fee above 100 is a typo every time — somebody has typed the
     * rupee amount into the percent field. Refused rather than saved, because
     * the first anybody would notice is an invoice for four times the spend.
     */
    const feeType = data.feeType || existing?.feeType;
    const feeValue = data.feeValue === undefined ? existing?.feeValue : Number(data.feeValue);
    if (feeType === "percent_of_spend" && feeValue > 100) {
      throw new InvalidInput("A management fee of more than 100% of spend is almost certainly a typo");
    }

    if (data.teamLeaders !== undefined || data.employees !== undefined) {
      const leaders = asIdList(data.teamLeaders ?? existing?.teamLeaders);
      const staff = asIdList(data.employees ?? existing?.employees);
      data.teamLeaders = leaders;
      data.employees = staff;
      data.assignments = mergeAssignments(existing?.assignments, [...leaders, ...staff], req.admin);
    }

    if (!existing) data.createdBy = req.admin?._id;

    return data;
  },

  afterSave: (doc, req, { isNew, previous }) => {
    const before = [...(previous?.teamLeaders || []), ...(previous?.employees || [])];
    const after = [...(doc.teamLeaders || []), ...(doc.employees || [])];

    notifyUsers(isNew ? after : newcomers(before, after), {
      type: "assignment",
      title: "You were put on an ad account",
      message: `${doc.name} (${doc.platform})`,
      link: "/ads",
    });
  },
});

/** Everything one account screen needs: campaigns, pacing, and the money. */
export const accountDetail = async (req, res) => {
  try {
    const account = await AdAccount.findById(req.params.id)
      .populate("client", "name company email")
      .populate("teamLeaders", "name email")
      .populate("employees", "name email")
      .populate("credential", "label type");

    if (!account) return res.status(404).json({ message: "Ad account not found" });

    const { from, to } = monthBounds();

    const [campaigns, thisMonth, money] = await Promise.all([
      AdCampaign.find({ adAccount: account._id }).select("-daily").sort({ status: 1, name: 1 }),
      spendBetween(account._id, from, to),
      moneyPosition(account),
    ]);

    return res.status(200).json({
      item: account,
      campaigns,
      thisMonth: derive(thisMonth),
      pacing: pace(account.monthlyBudget, thisMonth.spend),
      money,
    });
  } catch (err) {
    console.error("accountDetail error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Every account at a glance — which are overspending, which have run dry, and
 * which are owed for. This is the screen somebody opens each morning.
 */
export const adsOverview = async (req, res) => {
  try {
    const { from, to } = monthBounds();
    const live = await AdAccount.find({ status: "active" }).populate("client", "name company");

    const rows = await Promise.all(
      live.map(async (account) => {
        const totals = await spendBetween(account._id, from, to);
        const money = await moneyPosition(account);

        return {
          _id: account._id,
          name: account.name,
          platform: account.platform,
          client: account.client,
          funding: account.funding,
          currency: account.currency,
          thisMonth: derive(totals),
          pacing: pace(account.monthlyBudget, totals.spend),
          money,
        };
      })
    );

    const overspending = rows.filter((row) => row.pacing && row.pacing.variance > 0);
    const dry = rows.filter((row) => row.money.kind === "balance" && row.money.exhausted);
    const owed = rows.filter((row) => row.money.kind === "recoverable" && row.money.unrecovered > 0);

    return res.status(200).json({
      accounts: rows,
      totals: {
        spendThisMonth: round(rows.reduce((sum, row) => sum + row.thisMonth.spend, 0)),
        owedToStudio: round(rows.reduce((sum, row) => sum + (row.money.unrecovered || 0), 0)),
      },
      alerts: {
        overspending: overspending.map((row) => ({
          _id: row._id,
          name: row.name,
          over: row.pacing.variance,
        })),
        outOfMoney: dry.map((row) => ({ _id: row._id, name: row.name, balance: row.money.balance })),
        awaitingRecovery: owed.length,
      },
    });
  } catch (err) {
    console.error("adsOverview error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------- campaigns */

export const listCampaigns = async (req, res) => {
  try {
    const campaigns = await AdCampaign.find({ adAccount: req.params.id })
      .select("-daily")
      .sort({ status: 1, name: 1 });
    return res.status(200).json({ items: campaigns });
  } catch (err) {
    console.error("listCampaigns error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const campaignDetail = async (req, res) => {
  try {
    const campaign = await AdCampaign.findById(req.params.campaignId);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });

    return res.status(200).json({
      item: campaign,
      totals: derive({
        spend: campaign.totalSpend,
        impressions: campaign.totalImpressions,
        clicks: campaign.totalClicks,
        conversions: campaign.totalConversions,
        conversionValue: campaign.totalConversionValue,
      }),
    });
  } catch (err) {
    console.error("campaignDetail error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const createCampaign = async (req, res) => {
  try {
    const account = await AdAccount.findById(req.params.id).select("_id");
    if (!account) return res.status(404).json({ message: "Ad account not found" });

    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ message: "A campaign name is required" });

    const campaign = await AdCampaign.create({
      adAccount: account._id,
      name,
      externalId: req.body.externalId || "",
      objective: req.body.objective || "leads",
      status: req.body.status || "active",
      dailyBudget: Number(req.body.dailyBudget) || 0,
      totalBudget: Number(req.body.totalBudget) || 0,
      startedOn: req.body.startedOn || null,
      endedOn: req.body.endedOn || null,
      notes: req.body.notes || "",
      createdBy: req.admin?._id,
    });

    return res.status(201).json({ message: "Campaign added", item: campaign });
  } catch (err) {
    console.error("createCampaign error:", err);
    if (err.code === 11000) {
      return res.status(409).json({ message: "A campaign with that name is already on this account" });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateCampaign = async (req, res) => {
  try {
    const campaign = await AdCampaign.findById(req.params.campaignId);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });

    ["name", "externalId", "objective", "status", "notes"].forEach((field) => {
      if (req.body[field] !== undefined) campaign[field] = req.body[field];
    });
    ["dailyBudget", "totalBudget"].forEach((field) => {
      if (req.body[field] !== undefined) campaign[field] = Number(req.body[field]) || 0;
    });
    ["startedOn", "endedOn"].forEach((field) => {
      if (req.body[field] !== undefined) campaign[field] = req.body[field] || null;
    });

    await campaign.save();
    return res.status(200).json({ message: "Campaign updated", item: campaign });
  } catch (err) {
    console.error("updateCampaign error:", err);
    if (err.code === 11000) {
      return res.status(409).json({ message: "A campaign with that name is already on this account" });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

export const removeCampaign = async (req, res) => {
  try {
    const campaign = await AdCampaign.findByIdAndDelete(req.params.campaignId);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });

    logActivity(req, {
      action: "deleted",
      entity: "Ad campaign",
      entityId: campaign._id,
      message: `Campaign "${campaign.name}" deleted with ${campaign.daily.length} days of data`,
    });

    return res.status(200).json({ message: "Campaign deleted" });
  } catch (err) {
    console.error("removeCampaign error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------- the numbers */

/**
 * Write one day onto one campaign.
 *
 * Re-entering a day replaces it rather than adding a second row. Platform
 * figures move for a day or two after the fact — attribution settles, spend is
 * adjusted — so re-importing yesterday is normal, and two rows for one date
 * would silently double a month's spend.
 */
const writeDay = (campaign, row) => {
  const date = startOfDay(row.date);

  const entry = {
    date,
    spend: round(row.spend),
    impressions: Math.round(Number(row.impressions) || 0),
    clicks: Math.round(Number(row.clicks) || 0),
    conversions: round(row.conversions),
    conversionValue: round(row.conversionValue),
  };

  const existing = campaign.daily.findIndex(
    (day) => new Date(day.date).toDateString() === date.toDateString()
  );

  if (existing >= 0) campaign.daily[existing] = entry;
  else campaign.daily.push(entry);

  return existing >= 0;
};

export const recordDay = async (req, res) => {
  try {
    const campaign = await AdCampaign.findById(req.params.campaignId);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });

    if (!req.body.date) return res.status(400).json({ message: "Which day is this for?" });

    const spend = Number(req.body.spend);
    if (!Number.isFinite(spend) || spend < 0) {
      return res.status(400).json({ message: "Spend must be a number, and not a negative one" });
    }

    const replaced = writeDay(campaign, req.body);
    campaign.refreshTotals();
    await campaign.save();

    return res.status(200).json({
      message: replaced ? "That day was updated" : "Day recorded",
      item: campaign,
    });
  } catch (err) {
    console.error("recordDay error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Take a batch of rows off a platform export.
 *
 * Rows arrive already parsed, as { campaign, date, spend, … }. Campaigns are
 * matched by name because that is what every export carries; one that is not
 * on file yet is created rather than refused, since the alternative is making
 * somebody type twenty campaign names before their first import.
 *
 * The whole batch is reported on — imported, updated, created, skipped — so a
 * misread column shows up as "0 imported, 40 skipped" instead of quietly
 * writing forty rows of zeroes.
 */
export const importDays = async (req, res) => {
  try {
    const account = await AdAccount.findById(req.params.id).select("_id name");
    if (!account) return res.status(404).json({ message: "Ad account not found" });

    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ message: "Nothing to import" });
    if (rows.length > 5000) {
      return res.status(400).json({ message: "That is more than 5,000 rows — split the file" });
    }

    const report = { imported: 0, updated: 0, campaignsCreated: [], skipped: [] };
    const touched = new Map();

    for (const [index, row] of rows.entries()) {
      const name = String(row.campaign || "").trim();
      const spend = Number(row.spend);

      if (!name) {
        report.skipped.push({ row: index + 1, reason: "no campaign name" });
        continue;
      }
      if (!row.date || Number.isNaN(new Date(row.date).getTime())) {
        report.skipped.push({ row: index + 1, reason: "the date could not be read" });
        continue;
      }
      if (!Number.isFinite(spend) || spend < 0) {
        report.skipped.push({ row: index + 1, reason: "the spend could not be read" });
        continue;
      }

      let campaign = touched.get(name);
      if (!campaign) {
        campaign = await AdCampaign.findOne({ adAccount: account._id, name });
        if (!campaign) {
          campaign = await AdCampaign.create({
            adAccount: account._id,
            name,
            createdBy: req.admin?._id,
          });
          report.campaignsCreated.push(name);
        }
        touched.set(name, campaign);
      }

      if (writeDay(campaign, row)) report.updated++;
      else report.imported++;
    }

    await Promise.all([...touched.values()].map((campaign) => campaign.refreshTotals().save()));

    logActivity(req, {
      action: "created",
      entity: "Ad campaign",
      entityId: account._id,
      message: `${account.name}: imported ${report.imported} days, updated ${report.updated}`,
    });

    return res.status(200).json({
      message: `${report.imported} day(s) imported, ${report.updated} updated${
        report.skipped.length ? `, ${report.skipped.length} skipped` : ""
      }`,
      report,
    });
  } catch (err) {
    console.error("importDays error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- the money */

/** Money the client has sent up front, for a prepaid account. */
export const addTopup = async (req, res) => {
  try {
    const account = await AdAccount.findById(req.params.id);
    if (!account) return res.status(404).json({ message: "Ad account not found" });

    if (account.funding !== "prepaid") {
      return res.status(409).json({
        message: "This account is not prepaid — top-ups only make sense where the client pays in advance",
      });
    }

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Enter the amount received" });
    }

    account.topups.push({
      amount,
      receivedOn: req.body.receivedOn || new Date(),
      mode: req.body.mode || "bank_transfer",
      reference: req.body.reference || "",
      note: req.body.note || "",
      recordedByName: req.admin?.name || "",
    });

    await account.save();

    logActivity(req, {
      action: "updated",
      entity: "Ad account",
      entityId: account._id,
      message: `₹${amount} added to ${account.name}`,
    });

    return res.status(200).json({ message: "Top-up recorded", money: await moneyPosition(account) });
  } catch (err) {
    console.error("addTopup error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Bill a period: the spend the studio fronted, plus its fee.
 *
 * This is the reason the module exists. An account funded from the studio's
 * card accumulates a debt every day nobody looks at it, and the way that debt
 * gets forgotten is that recovering it means opening the platform, adding up a
 * month, and remembering the fee. Here it is one request that produces a real
 * invoice and writes down which period it covered — so the same month can
 * never be billed twice, and the next one starts where this ended.
 */
export const billPeriod = async (req, res) => {
  try {
    const account = await AdAccount.findById(req.params.id).populate("client", "name company");
    if (!account) return res.status(404).json({ message: "Ad account not found" });

    const from = req.body.from ? startOfDay(req.body.from) : monthBounds().from;
    const to = req.body.to ? new Date(req.body.to) : monthBounds().to;
    to.setHours(23, 59, 59, 999);

    if (from > to) return res.status(400).json({ message: "That period ends before it starts" });

    /**
     * A period that overlaps one already billed is refused. Billing the same
     * fortnight twice is not a mistake anybody catches from an invoice — it is
     * caught months later, by a client.
     */
    const overlap = (account.recoveries || []).find(
      (row) => from <= new Date(row.to) && to >= new Date(row.from)
    );
    if (overlap) {
      return res.status(409).json({
        message: `That period overlaps one already billed on ${
          overlap.invoiceNumber || "an earlier invoice"
        } (${new Date(overlap.from).toLocaleDateString("en-IN")} – ${new Date(
          overlap.to
        ).toLocaleDateString("en-IN")})`,
      });
    }

    const totals = await spendBetween(account._id, from, to);
    const fee = feeFor(account, totals.spend);

    if (!totals.spend && !fee) {
      return res.status(400).json({ message: "Nothing was spent in that period and there is no fee to charge" });
    }

    const config = await settings();
    const period = `${from.toLocaleDateString("en-IN")} – ${to.toLocaleDateString("en-IN")}`;
    const lines = [];

    /**
     * Ad spend is only a line where the studio actually paid for it. On a
     * client-card or prepaid account the money never passed through the
     * studio, and invoicing it would be billing them for their own money.
     */
    if (account.funding === "studio_card" && totals.spend > 0) {
      lines.push({
        description: `Ad spend — ${account.name} (${account.platform}) · ${period}`,
        quantity: 1,
        rate: totals.spend,
        taxPercent: Number(req.body.spendTaxPercent) || 0,
      });
    }

    if (fee > 0) {
      lines.push({
        description:
          account.feeType === "percent_of_spend"
            ? `Ad management fee (${account.feeValue}% of spend) · ${period}`
            : `Ad management fee · ${period}`,
        quantity: 1,
        rate: fee,
        taxPercent: req.body.feeTaxPercent === undefined ? 18 : Number(req.body.feeTaxPercent),
      });
    }

    const invoice = await raiseInvoice({
      clientId: account.client._id,
      lines,
      actor: req.admin,
      title: `${account.name} — ${period}`,
      status: "draft",
      dueOn: req.body.dueOn || null,
      periodLabel: period,
      isRecurring: true,
      terms: config?.invoiceTerms || "",
    });

    if (account.funding === "studio_card") {
      account.recoveries.push({
        from,
        to,
        amount: totals.spend,
        invoice: invoice._id,
        invoiceNumber: invoice.number,
        recordedByName: req.admin?.name || "",
      });
      await account.save();
    }

    logActivity(req, {
      action: "created",
      entity: "Invoice",
      entityId: invoice._id,
      message: `${invoice.number} raised for ${account.name} (${period})`,
    });

    return res.status(201).json({
      message: `Invoice ${invoice.number} raised as a draft`,
      invoice,
      spend: totals.spend,
      fee,
    });
  } catch (err) {
    console.error("billPeriod error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/* ------------------------------------------------------------- the report */

/**
 * What the client is shown for a period: the totals, and each campaign's part
 * in them. The same shape the SEO report has, for the same reason — a retainer
 * sells a report, and building one by hand is where the margin goes.
 */
export const periodReport = async (req, res) => {
  try {
    const account = await AdAccount.findById(req.params.id).populate("client", "name company");
    if (!account) return res.status(404).json({ message: "Ad account not found" });

    const bounds = monthBounds();
    const from = req.query.from ? startOfDay(req.query.from) : bounds.from;
    const to = req.query.to ? new Date(req.query.to) : bounds.to;
    to.setHours(23, 59, 59, 999);

    // The same window, one month earlier, so every figure has something to be
    // compared against — a spend number on its own says nothing.
    const span = to.getTime() - from.getTime();
    const priorFrom = new Date(from.getTime() - span - 86400000);
    const priorTo = new Date(from.getTime() - 1);

    const [totals, prior, campaigns] = await Promise.all([
      spendBetween(account._id, from, to),
      spendBetween(account._id, priorFrom, priorTo),
      AdCampaign.find({ adAccount: account._id }),
    ]);

    const perCampaign = campaigns
      .map((campaign) => {
        const inWindow = campaign.daily.filter(
          (day) => new Date(day.date) >= from && new Date(day.date) <= to
        );

        const summed = inWindow.reduce(
          (acc, day) => ({
            spend: acc.spend + (day.spend || 0),
            impressions: acc.impressions + (day.impressions || 0),
            clicks: acc.clicks + (day.clicks || 0),
            conversions: acc.conversions + (day.conversions || 0),
            conversionValue: acc.conversionValue + (day.conversionValue || 0),
          }),
          { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }
        );

        return {
          _id: campaign._id,
          name: campaign.name,
          objective: campaign.objective,
          status: campaign.status,
          ...derive({
            spend: round(summed.spend),
            impressions: summed.impressions,
            clicks: summed.clicks,
            conversions: round(summed.conversions),
            conversionValue: round(summed.conversionValue),
          }),
        };
      })
      .filter((row) => row.spend > 0 || row.impressions > 0)
      .sort((a, b) => b.spend - a.spend);

    /** The daily series, for a spend-over-time line. */
    const byDay = new Map();
    campaigns.forEach((campaign) => {
      campaign.daily.forEach((day) => {
        const when = new Date(day.date);
        if (when < from || when > to) return;
        const key = when.toISOString().slice(0, 10);
        const current = byDay.get(key) || { date: key, spend: 0, clicks: 0, conversions: 0 };
        current.spend = round(current.spend + (day.spend || 0));
        current.clicks += day.clicks || 0;
        current.conversions = round(current.conversions + (day.conversions || 0));
        byDay.set(key, current);
      });
    });

    return res.status(200).json({
      account: {
        _id: account._id,
        name: account.name,
        platform: account.platform,
        client: account.client,
        currency: account.currency,
        funding: account.funding,
      },
      period: { from, to },
      totals: derive(totals),
      previous: derive(prior),
      pacing: pace(account.monthlyBudget, totals.spend),
      campaigns: perCampaign,
      daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      fee: feeFor(account, totals.spend),
    });
  } catch (err) {
    console.error("periodReport error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------- what a staff member may see */

export const myAdsWork = async (req, res) => {
  try {
    const user = req.leader || req.employee;
    const isLeader = Boolean(req.leader);

    const query = isLeader
      ? { $or: [{ teamLeaders: user._id }, { employees: user._id }] }
      : { employees: user._id };

    const mine = await AdAccount.find(query).populate("client", "name company").sort({ name: 1 });
    const { from, to } = monthBounds();

    const rows = await Promise.all(
      mine.map(async (account) => {
        const totals = await spendBetween(account._id, from, to);
        return {
          _id: account._id,
          name: account.name,
          platform: account.platform,
          client: account.client,
          status: account.status,
          currency: account.currency,
          thisMonth: derive(totals),
          pacing: pace(account.monthlyBudget, totals.spend),
        };
      })
    );

    return res.status(200).json({ accounts: rows });
  } catch (err) {
    console.error("myAdsWork error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** One account, for a staff member who is on it. */
export const myAccountDetail = async (req, res) => {
  try {
    const user = req.leader || req.employee;

    const account = await AdAccount.findById(req.params.id).populate("client", "name company");
    if (!account) return res.status(404).json({ message: "Ad account not found" });

    const onIt =
      (account.employees || []).some((id) => String(id) === String(user._id)) ||
      (account.teamLeaders || []).some((id) => String(id) === String(user._id));

    if (!onIt) return res.status(403).json({ message: "You are not assigned to this ad account" });

    const { from, to } = monthBounds();
    const [campaigns, totals] = await Promise.all([
      AdCampaign.find({ adAccount: account._id }).select("-daily").sort({ status: 1, name: 1 }),
      spendBetween(account._id, from, to),
    ]);

    /**
     * Deliberately no money position. Whether the studio is owed for this
     * account, and how much of the client's advance is left, is between the
     * admin and the client — the person running the campaigns needs the
     * budget and the numbers, and nothing else here is theirs to see.
     */
    return res.status(200).json({
      item: {
        _id: account._id,
        name: account.name,
        platform: account.platform,
        client: account.client,
        status: account.status,
        currency: account.currency,
        monthlyBudget: account.monthlyBudget,
        externalId: account.externalId,
        notes: account.notes,
      },
      campaigns,
      thisMonth: derive(totals),
      pacing: pace(account.monthlyBudget, totals.spend),
    });
  } catch (err) {
    console.error("myAccountDetail error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** Staff record the numbers — that is the daily work. */
export const staffRecordDay = async (req, res) => {
  const user = req.leader || req.employee;

  const campaign = await AdCampaign.findById(req.params.campaignId).select("adAccount");
  if (!campaign) return res.status(404).json({ message: "Campaign not found" });

  const owning = await AdAccount.findOne({
    _id: campaign.adAccount,
    $or: [{ employees: user._id }, { teamLeaders: user._id }],
  }).select("_id");

  if (!owning) return res.status(403).json({ message: "You are not assigned to this ad account" });

  req.admin = user;
  return recordDay(req, res);
};
