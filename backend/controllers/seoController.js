import SeoProject from "../models/SeoProject.js";
import SeoKeyword from "../models/SeoKeyword.js";
import SeoAudit from "../models/SeoAudit.js";
import Backlink from "../models/Backlink.js";
import SocialAccount from "../models/SocialAccount.js";
import SocialPost from "../models/SocialPost.js";

import { buildCrud, InvalidInput } from "../utils/crud.js";
import { logActivity } from "../utils/activity.js";
import { notifyUsers } from "../utils/notify.js";

/**
 * SEO and social: the engagements, what is being tracked, and the monthly
 * report that is the actual deliverable.
 */

/* ------------------------------------------------------------------ helpers */

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

/** A date range from ?from / ?to, defaulting to the last thirty days. */
const readRange = (req) => {
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from
    ? new Date(req.query.from)
    : new Date(to.getTime() - 30 * 86400000);

  to.setHours(23, 59, 59, 999);
  from.setHours(0, 0, 0, 0);
  return { from, to };
};

/* -------------------------------------------------------------- engagements */

export const projects = buildCrud(SeoProject, {
  entity: "SEO engagement",
  searchFields: ["name", "website"],
  filterFields: ["status", "service", "client"],
  populate: [
    { path: "client", select: "name company" },
    { path: "teamLeaders", select: "name email" },
    { path: "employees", select: "name email" },
  ],
  sort: { createdAt: -1 },

  beforeSave: (payload, req, existing) => {
    const data = { ...payload };

    if (!data.client && !existing?.client) {
      throw new InvalidInput("Pick the client this engagement is for");
    }

    /**
     * Ending an engagement stamps the date, and reopening one clears it.
     * Otherwise a paused-then-resumed retainer keeps an end date in the past,
     * and every report that filters on it quietly returns nothing.
     */
    if (data.status === "ended" && existing?.status !== "ended") data.endedOn = new Date();
    if (data.status && data.status !== "ended") data.endedOn = null;

    if (data.competitors !== undefined) {
      data.competitors = (Array.isArray(data.competitors) ? data.competitors : [])
        .map((c) => String(c).trim())
        .filter(Boolean);
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
      title: "You were put on an SEO engagement",
      message: doc.name,
      link: "/seo",
    });
  },
});

/** Everything one engagement screen leads with. */
export const projectDetail = async (req, res) => {
  try {
    const project = await SeoProject.findById(req.params.id)
      .populate("client", "name company email")
      .populate("teamLeaders", "name email")
      .populate("employees", "name email");

    if (!project) return res.status(404).json({ message: "Engagement not found" });

    const [keywords, latestAudit, backlinks, accounts, upcoming] = await Promise.all([
      SeoKeyword.find({ seoProject: project._id })
        .select("-history")
        .sort({ currentPosition: 1, term: 1 }),
      SeoAudit.findOne({ seoProject: project._id }).sort({ ranOn: -1 }),
      Backlink.countDocuments({ seoProject: project._id, status: "live" }),
      SocialAccount.find({ seoProject: project._id }).sort({ platform: 1 }),
      SocialPost.find({
        seoProject: project._id,
        status: { $in: ["approved", "scheduled", "awaiting_approval"] },
      })
        .sort({ scheduledFor: 1 })
        .limit(10),
    ]);

    return res.status(200).json({
      item: project,
      keywords,
      latestAudit,
      liveBacklinks: backlinks,
      socialAccounts: accounts,
      upcomingPosts: upcoming,
    });
  } catch (err) {
    console.error("seo projectDetail error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------------- keywords */

export const listKeywords = async (req, res) => {
  try {
    const keywords = await SeoKeyword.find({ seoProject: req.params.id })
      .select("-history")
      .sort({ currentPosition: 1, term: 1 });
    return res.status(200).json({ items: keywords });
  } catch (err) {
    console.error("listKeywords error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const keywordHistory = async (req, res) => {
  try {
    const keyword = await SeoKeyword.findById(req.params.keywordId);
    if (!keyword) return res.status(404).json({ message: "Keyword not found" });
    return res.status(200).json({ item: keyword });
  } catch (err) {
    console.error("keywordHistory error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Add terms to an engagement, one or many.
 *
 * Takes a list because that is how keywords actually arrive — pasted from a
 * spreadsheet, thirty at a time. Duplicates are skipped rather than refused,
 * so pasting a list that overlaps last month's does the obvious thing instead
 * of failing on row four and leaving the first three added.
 */
export const addKeywords = async (req, res) => {
  try {
    const project = await SeoProject.findById(req.params.id).select("_id");
    if (!project) return res.status(404).json({ message: "Engagement not found" });

    const incoming = Array.isArray(req.body.terms) ? req.body.terms : [req.body.term];
    const shared = {
      engine: req.body.engine || "google",
      location: req.body.location || "India",
      device: req.body.device || "desktop",
      priority: req.body.priority || "medium",
      targetUrl: req.body.targetUrl || "",
    };

    const terms = [...new Set(incoming.map((t) => String(t || "").trim()).filter(Boolean))];
    if (!terms.length) return res.status(400).json({ message: "No keywords given" });

    const existing = await SeoKeyword.find({
      seoProject: project._id,
      term: { $in: terms },
      engine: shared.engine,
      location: shared.location,
      device: shared.device,
    }).select("term");

    const already = new Set(existing.map((k) => k.term));
    const fresh = terms.filter((t) => !already.has(t));

    const created = fresh.length
      ? await SeoKeyword.insertMany(
          fresh.map((term) => ({ seoProject: project._id, term, ...shared }))
        )
      : [];

    logActivity(req, {
      action: "created",
      entity: "SEO keyword",
      entityId: project._id,
      message: `${created.length} keyword(s) added`,
    });

    return res.status(201).json({
      message: `${created.length} added${already.size ? `, ${already.size} already tracked` : ""}`,
      items: created,
      skipped: [...already],
    });
  } catch (err) {
    console.error("addKeywords error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Record where a term sits today.
 *
 * The caches are recomputed from the series rather than nudged, so a correction
 * to a mistyped rank fixes every derived number too. `previousPosition` comes
 * from the point before the newest one, which is what "up 3 places" means.
 */
export const recordRank = async (req, res) => {
  try {
    const keyword = await SeoKeyword.findById(req.params.keywordId);
    if (!keyword) return res.status(404).json({ message: "Keyword not found" });

    const raw = req.body.position;
    const position = raw === null || raw === "" || raw === undefined ? null : Number(raw);

    if (position !== null && (!Number.isInteger(position) || position < 1 || position > 100)) {
      return res
        .status(400)
        .json({ message: "Position must be a whole number from 1 to 100, or blank for 'not ranking'" });
    }

    const when = req.body.date ? new Date(req.body.date) : new Date();
    when.setHours(12, 0, 0, 0);

    // Re-checking the same day replaces that day's reading rather than adding a
    // second one — two points for one date would break every graph downstream.
    const sameDay = keyword.history.findIndex(
      (point) => new Date(point.date).toDateString() === when.toDateString()
    );
    if (sameDay >= 0) keyword.history[sameDay].position = position;
    else keyword.history.push({ date: when, position });

    keyword.history.sort((a, b) => new Date(a.date) - new Date(b.date));

    const series = keyword.history;
    const ranked = series.filter((p) => p.position !== null).map((p) => p.position);

    keyword.currentPosition = series[series.length - 1]?.position ?? null;
    keyword.previousPosition = series[series.length - 2]?.position ?? null;
    keyword.bestPosition = ranked.length ? Math.min(...ranked) : null;
    keyword.lastCheckedAt = series[series.length - 1]?.date || null;

    await keyword.save();

    return res.status(200).json({ message: "Rank recorded", item: keyword });
  } catch (err) {
    console.error("recordRank error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateKeyword = async (req, res) => {
  try {
    const keyword = await SeoKeyword.findById(req.params.keywordId);
    if (!keyword) return res.status(404).json({ message: "Keyword not found" });

    const allowed = ["term", "targetUrl", "priority", "volume", "difficulty"];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) keyword[field] = req.body[field];
    });

    await keyword.save();
    return res.status(200).json({ message: "Keyword updated", item: keyword });
  } catch (err) {
    console.error("updateKeyword error:", err);
    if (err.code === 11000) {
      return res.status(409).json({ message: "That keyword is already tracked here" });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

export const removeKeyword = async (req, res) => {
  try {
    const gone = await SeoKeyword.findByIdAndDelete(req.params.keywordId);
    if (!gone) return res.status(404).json({ message: "Keyword not found" });
    return res.status(200).json({ message: "Keyword removed" });
  } catch (err) {
    console.error("removeKeyword error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------------ audits */

export const audits = buildCrud(SeoAudit, {
  entity: "Audit",
  searchFields: ["title", "url", "summary"],
  filterFields: ["seoProject"],
  sort: { ranOn: -1 },
  label: (doc) => doc?.title || "audit",
  beforeSave: (payload, req, existing) => {
    const data = { ...payload };
    if (!data.seoProject && !existing?.seoProject) {
      throw new InvalidInput("An audit belongs to an engagement");
    }
    if (!existing) {
      data.createdBy = req.admin?._id;
      data.createdByName = req.admin?.name || "";
    }
    return data;
  },
});

/** Work through an audit's findings without rewriting the whole document. */
export const updateAuditIssue = async (req, res) => {
  try {
    const audit = await SeoAudit.findById(req.params.id);
    if (!audit) return res.status(404).json({ message: "Audit not found" });

    const issue = audit.issues.id(req.params.issueId);
    if (!issue) return res.status(404).json({ message: "Finding not found" });

    if (req.body.status !== undefined) {
      issue.status = req.body.status;
      issue.fixedAt = req.body.status === "fixed" ? new Date() : null;
    }
    if (req.body.detail !== undefined) issue.detail = req.body.detail;

    await audit.save();
    return res.status(200).json({ message: "Finding updated", item: audit });
  } catch (err) {
    console.error("updateAuditIssue error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- backlinks */

export const backlinks = buildCrud(Backlink, {
  entity: "Backlink",
  searchFields: ["sourceUrl", "sourceDomain", "anchorText"],
  filterFields: ["seoProject", "status", "type"],
  sort: { createdAt: -1 },
  label: (doc) => doc?.sourceDomain || doc?.sourceUrl || "",

  beforeSave: (payload, req, existing) => {
    const data = { ...payload };

    if (!data.seoProject && !existing?.seoProject) {
      throw new InvalidInput("A backlink belongs to an engagement");
    }

    /**
     * The domain is derived rather than typed. It is what every grouping and
     * duplicate check reads, and asking a person to retype it from the URL is
     * asking for "www.site.com" and "site.com" to become two domains.
     */
    const url = data.sourceUrl || existing?.sourceUrl;
    if (url) {
      try {
        data.sourceDomain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname
          .replace(/^www\./, "")
          .toLowerCase();
      } catch {
        throw new InvalidInput("That source URL does not look like a web address");
      }
    }

    if (data.status === "lost" && existing?.status !== "lost") data.lostAt = new Date();
    if (data.status && data.status !== "lost") data.lostAt = null;

    if (!existing) data.createdBy = req.admin?._id;

    return data;
  },
});

/** Mark a batch as still there — the routine somebody does monthly. */
export const checkBacklinks = async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const status = req.body.status || "live";

    if (!ids.length) return res.status(400).json({ message: "Nothing selected" });

    const patch = { status, lastCheckedAt: new Date() };
    if (status === "lost") patch.lostAt = new Date();
    else patch.lostAt = null;

    const result = await Backlink.updateMany({ _id: { $in: ids } }, patch);

    logActivity(req, {
      action: "updated",
      entity: "Backlink",
      entityId: ids[0],
      message: `${result.modifiedCount} backlink(s) marked ${status}`,
    });

    return res.status(200).json({ message: `${result.modifiedCount} marked ${status}` });
  } catch (err) {
    console.error("checkBacklinks error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------------ social */

export const socialAccounts = buildCrud(SocialAccount, {
  entity: "Social account",
  searchFields: ["handle", "profileUrl"],
  filterFields: ["client", "platform", "status", "seoProject"],
  populate: [{ path: "client", select: "name company" }],
  sort: { createdAt: -1 },
  label: (doc) => `${doc?.platform} ${doc?.handle}`,
  beforeSave: (payload, req, existing) => {
    const data = { ...payload };
    if (!data.client && !existing?.client) throw new InvalidInput("Pick the client");
    if (!existing) data.createdBy = req.admin?._id;
    return data;
  },
});

/** Log today's follower count, keeping the series the growth chart reads. */
export const recordFollowers = async (req, res) => {
  try {
    const account = await SocialAccount.findById(req.params.id);
    if (!account) return res.status(404).json({ message: "Account not found" });

    const followers = Number(req.body.followers);
    if (!Number.isFinite(followers) || followers < 0) {
      return res.status(400).json({ message: "Follower count must be a number" });
    }

    const when = req.body.date ? new Date(req.body.date) : new Date();
    when.setHours(12, 0, 0, 0);

    const sameDay = account.followerHistory.findIndex(
      (point) => new Date(point.date).toDateString() === when.toDateString()
    );
    if (sameDay >= 0) account.followerHistory[sameDay].followers = followers;
    else account.followerHistory.push({ date: when, followers });

    account.followerHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
    account.followers = account.followerHistory[account.followerHistory.length - 1].followers;

    await account.save();
    return res.status(200).json({ message: "Followers recorded", item: account });
  } catch (err) {
    console.error("recordFollowers error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const socialPosts = buildCrud(SocialPost, {
  entity: "Post",
  searchFields: ["title", "caption"],
  filterFields: ["client", "status", "seoProject", "assignedTo"],
  populate: [
    { path: "client", select: "name company" },
    { path: "accounts", select: "platform handle" },
    { path: "assignedTo", select: "name" },
  ],
  sort: { scheduledFor: 1, createdAt: -1 },
  label: (doc) => doc?.title || "post",

  extraQuery: (req) => {
    // The calendar asks for one month at a time
    if (!req.query.month) return {};
    const [year, month] = String(req.query.month).split("-").map(Number);
    if (!year || !month) return {};
    return {
      scheduledFor: {
        $gte: new Date(year, month - 1, 1),
        $lt: new Date(year, month, 1),
      },
    };
  },

  beforeSave: (payload, req, existing) => {
    const data = { ...payload };

    if (!data.client && !existing?.client) throw new InvalidInput("Pick the client");

    if (data.hashtags !== undefined) {
      data.hashtags = (Array.isArray(data.hashtags) ? data.hashtags : [])
        .map((tag) => String(tag).trim().replace(/^#/, ""))
        .filter(Boolean);
    }

    /**
     * Publishing without a date recorded is how a month's report ends up
     * saying nothing went out. Stamped from the status rather than left to be
     * filled in separately.
     */
    if (data.status === "published" && existing?.status !== "published") {
      data.publishedAt = data.publishedAt || new Date();
    }
    if (data.status === "approved" && existing?.status !== "approved") {
      data.approvedAt = new Date();
      data.approvedByName = data.approvedByName || req.admin?.name || "";
    }

    if (!existing) data.createdBy = req.admin?._id;

    return data;
  },

  afterSave: (doc, req, { isNew, previous }) => {
    if (!doc.assignedTo) return;
    if (!isNew && String(previous?.assignedTo || "") === String(doc.assignedTo)) return;

    notifyUsers([doc.assignedTo], {
      type: "assignment",
      title: "A post was assigned to you",
      message: doc.title || "Untitled post",
      link: "/seo/social",
    });
  },
});

/* ------------------------------------------------------------ the report */

/**
 * The monthly report — what the client is actually paying to see.
 *
 * Everything here is computed from the records the team already keeps, which
 * is the whole argument for keeping them: a month of ranking work becomes a
 * report by asking, not by somebody spending a Friday in a spreadsheet.
 *
 * Movement is measured against the last reading before the window opened, not
 * against the first reading inside it. Otherwise a term checked on the 3rd
 * shows a month of movement as if it happened in 28 days.
 */
export const monthlyReport = async (req, res) => {
  try {
    const project = await SeoProject.findById(req.params.id).populate("client", "name company");
    if (!project) return res.status(404).json({ message: "Engagement not found" });

    const { from, to } = readRange(req);

    const [keywords, accounts, posts, newLinks, lostLinks, liveLinks, audit, priorAudit] =
      await Promise.all([
        SeoKeyword.find({ seoProject: project._id }),
        SocialAccount.find({ seoProject: project._id }),
        SocialPost.find({
          seoProject: project._id,
          status: "published",
          publishedAt: { $gte: from, $lte: to },
        }).populate("accounts", "platform handle"),
        Backlink.countDocuments({ seoProject: project._id, acquiredOn: { $gte: from, $lte: to } }),
        Backlink.countDocuments({ seoProject: project._id, lostAt: { $gte: from, $lte: to } }),
        Backlink.countDocuments({ seoProject: project._id, status: "live" }),
        SeoAudit.findOne({ seoProject: project._id, ranOn: { $lte: to } }).sort({ ranOn: -1 }),
        SeoAudit.findOne({ seoProject: project._id, ranOn: { $lt: from } }).sort({ ranOn: -1 }),
      ]);

    /** The reading in force when the window opened, and the latest inside it. */
    const movement = keywords.map((keyword) => {
      const before = [...keyword.history]
        .filter((p) => new Date(p.date) < from)
        .pop();
      const inside = [...keyword.history].filter(
        (p) => new Date(p.date) >= from && new Date(p.date) <= to
      );
      const now = inside[inside.length - 1] || before || null;

      const start = before?.position ?? null;
      const end = now?.position ?? null;

      // Lower is better, so a drop in number is a gain in rank
      const change = start !== null && end !== null ? start - end : null;

      return {
        _id: keyword._id,
        term: keyword.term,
        location: keyword.location,
        startPosition: start,
        currentPosition: end,
        change,
        best: keyword.bestPosition,
      };
    });

    const ranking = movement.filter((m) => m.currentPosition !== null);

    const summary = {
      tracked: keywords.length,
      ranking: ranking.length,
      topTen: ranking.filter((m) => m.currentPosition <= 10).length,
      topThree: ranking.filter((m) => m.currentPosition <= 3).length,
      improved: movement.filter((m) => m.change > 0).length,
      declined: movement.filter((m) => m.change < 0).length,
      unchanged: movement.filter((m) => m.change === 0).length,
      newlyRanking: movement.filter((m) => m.startPosition === null && m.currentPosition !== null)
        .length,
    };

    const followers = accounts.map((account) => {
      const before = [...account.followerHistory].filter((p) => new Date(p.date) < from).pop();
      const inside = [...account.followerHistory].filter(
        (p) => new Date(p.date) >= from && new Date(p.date) <= to
      );
      const now = inside[inside.length - 1] || before || null;

      return {
        _id: account._id,
        platform: account.platform,
        handle: account.handle,
        start: before?.followers ?? null,
        current: now?.followers ?? account.followers,
        gained:
          before && now ? now.followers - before.followers : null,
      };
    });

    const movers = [...movement]
      .filter((m) => m.change !== null && m.change !== 0)
      .sort((a, b) => b.change - a.change);

    return res.status(200).json({
      engagement: {
        _id: project._id,
        name: project.name,
        website: project.website,
        client: project.client,
        service: project.service,
      },
      period: { from, to },
      keywords: { summary, rows: movement, gained: movers.slice(0, 5), lost: movers.slice(-5).reverse() },
      backlinks: { gained: newLinks, lost: lostLinks, live: liveLinks },
      social: {
        postsPublished: posts.length,
        posts: posts.map((p) => ({
          _id: p._id,
          title: p.title,
          publishedAt: p.publishedAt,
          liveUrl: p.liveUrl,
          accounts: p.accounts,
        })),
        followers,
      },
      audit: audit
        ? {
            ranOn: audit.ranOn,
            scores: audit.scores,
            previousScores: priorAudit?.scores || null,
            openIssues: audit.issues.filter((i) => i.status === "open").length,
            fixedIssues: audit.issues.filter((i) => i.status === "fixed").length,
          }
        : null,
    });
  } catch (err) {
    console.error("monthlyReport error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------- what a staff member may see */

export const mySeoWork = async (req, res) => {
  try {
    const user = req.leader || req.employee;
    const isLeader = Boolean(req.leader);

    const query = isLeader
      ? { $or: [{ teamLeaders: user._id }, { employees: user._id }] }
      : { employees: user._id };

    const engagements = await SeoProject.find(query)
      .populate("client", "name company")
      .sort({ name: 1 });

    const ids = engagements.map((e) => e._id);

    const [posts, keywordCount] = await Promise.all([
      SocialPost.find({
        $or: [{ seoProject: { $in: ids } }, { assignedTo: user._id }],
        status: { $nin: ["published", "cancelled"] },
      })
        .sort({ scheduledFor: 1 })
        .limit(25)
        .populate("client", "name")
        .populate("accounts", "platform handle"),
      SeoKeyword.countDocuments({ seoProject: { $in: ids } }),
    ]);

    return res.status(200).json({ engagements, posts, keywordCount });
  } catch (err) {
    console.error("mySeoWork error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
