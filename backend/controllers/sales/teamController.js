import Lead from "../../models/Lead.js";
import User, {
  DEPARTMENT_LABELS,
  SALES_ADMIN_ROLE,
  SALES_PANEL_ROLES,
} from "../../models/User.js";

import { logActivity } from "../../utils/activity.js";
import { notifyUser } from "../../utils/notify.js";
import {
  circleFilterFor,
  teamFilterFor,
  unclaimedTeamFilter,
} from "../../utils/salesAccess.js";
import { hashPassword } from "../../utils/password.js";
import { credentialsFor as readCredentials, resolvePassword } from "../../utils/staffPassword.js";

/**
 * The sales team's own logins, and how each of them is doing.
 *
 * Only the Sales head reaches these routes — requireSalesHead in
 * middleware/salesAuth.js. An account that can create accounts can create
 * another head, so exactly one role holds it.
 *
 * The role written on a create is hardcoded to "sales_exec" and never read
 * from the request. That is the whole guard: there is no body this screen can
 * send that produces an administrator, an HR account, or a second Sales head.
 * Promotion to head is a separate, deliberate edit.
 *
 * WHOSE TEAM
 *
 * Every read and write here is filtered to the manager's own reports. This
 * screen used to list every sales account in the company to every manager,
 * which was fine while there was one of them and wrong the moment HR opened a
 * second — two managers running two teams could rename, deactivate and delete
 * each other's people. The line is one level deep on purpose: a manager sees
 * the people who report to them, not their reports' reports, because a sales
 * floor is a floor and not an org chart.
 *
 * The exception is the unclaimed list. See unclaimedTeamFilter in
 * utils/salesAccess.js for why it exists.
 */

const label = (role) => DEPARTMENT_LABELS[role] || "Sales";

const shape = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  roleLabel: label(user.role),
  isSalesHead: user.role === SALES_ADMIN_ROLE,
  reportsTo: user.reportsTo?._id || user.reportsTo || null,
  // Populated on the list; the id alone on the writes, where the caller
  // already knows whose team they just changed.
  managerName: user.reportsTo?.name || "",
  phone: user.phone || "",
  designation: user.designation || "",
  department: user.department || "",
  status: user.status,
  joiningDate: user.joiningDate || null,
  createdAt: user.createdAt,
});

/**
 * What to store and what to show — both from utils/staffPassword, which is the
 * one place that knows the starting password this system hands out.
 */
const credentialsFor = (user) => ({
  ...readCredentials(user, "Sales panel"),
  loginUrl: "/",
});

/* ---------------------------------------------------------------- list */

/**
 * GET /api/sales/team
 *
 * This manager's own people, with the numbers that say how each of their
 * pipelines is going — counted from the leads themselves rather than stored
 * anywhere, so they cannot drift from the rows they summarise.
 *
 * ?view=unclaimed returns the executives no manager has taken responsibility
 * for instead. Same shape, same stats, so the screen renders one table either
 * way; the only difference is what a manager can do with a row.
 */
export const listSalesTeam = async (req, res) => {
  try {
    const unclaimed = String(req.query.view || "").trim() === "unclaimed";

    /**
     * Collected into $and rather than merged into one object: the team filter
     * and the search both want $or, and the second assignment would silently
     * drop the first — which is a scope filter, so losing it would widen the
     * list to the whole company the moment somebody typed in the search box.
     */
    const filters = [unclaimed ? unclaimedTeamFilter() : teamFilterFor(req.sales)];

    const status = String(req.query.status || "").trim();
    if (status && status !== "all") filters.push({ status });

    const search = String(req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filters.push({ $or: [{ name: regex }, { email: regex }, { phone: regex }] });
    }

    const members = await User.find({ $and: filters })
      .select("-password -documents -bank -previousEmployment")
      .populate("reportsTo", "name")
      .sort({ role: 1, name: 1 });

    /** Per-person pipeline, in one pass rather than a query each. */
    const byOwner = await Lead.aggregate([
      { $match: { owner: { $in: members.map((m) => m._id) } } },
      {
        $group: {
          _id: "$owner",
          leads: { $sum: 1 },
          won: { $sum: { $cond: [{ $eq: ["$stage", "won"] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ["$stage", "lost"] }, 1, 0] } },
          open: {
            $sum: { $cond: [{ $in: ["$stage", ["won", "lost"]] }, 0, 1] },
          },
          pipelineValue: {
            $sum: {
              $cond: [{ $in: ["$stage", ["won", "lost"]] }, 0, { $ifNull: ["$estimatedValue", 0] }],
            },
          },
          wonValue: {
            $sum: {
              $cond: [{ $eq: ["$stage", "won"] }, { $ifNull: ["$estimatedValue", 0] }, 0],
            },
          },
        },
      },
    ]);

    const stats = {};
    byOwner.forEach((row) => {
      stats[String(row._id)] = row;
    });

    /**
     * Counted over the whole team rather than the filtered list, so the tiles
     * keep saying how big the team is while somebody searches inside it.
     */
    const mine = teamFilterFor(req.sales);

    const [total, active, waiting] = await Promise.all([
      User.countDocuments(mine),
      User.countDocuments({ $and: [mine, { status: "active" }] }),
      User.countDocuments(unclaimedTeamFilter()),
    ]);

    return res.status(200).json({
      items: members.map((member) => {
        const s = stats[String(member._id)] || {};
        const decided = (s.won || 0) + (s.lost || 0);

        return {
          ...shape(member),
          stats: {
            leads: s.leads || 0,
            open: s.open || 0,
            won: s.won || 0,
            lost: s.lost || 0,
            pipelineValue: s.pipelineValue || 0,
            wonValue: s.wonValue || 0,
            // Of the deals that were actually decided. Counting undecided ones
            // as losses makes a busy month look like a bad one.
            conversionRate: decided ? Math.round(((s.won || 0) / decided) * 100) : 0,
          },
        };
      }),
      counts: { total, active, inactive: total - active, unclaimed: waiting, limit: null },
      view: unclaimed ? "unclaimed" : "team",
    });
  } catch (err) {
    console.error("listSalesTeam error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- get one */

// GET /api/sales/team/:id
export const getSalesMember = async (req, res) => {
  try {
    const member = await User.findOne({
      _id: req.params.id,
      ...teamFilterFor(req.sales),
    })
      .select("-documents -bank -previousEmployment")
      .populate("reportsTo", "name");

    if (!member) return res.status(404).json({ message: "That sales account was not found" });

    return res.status(200).json({
      item: shape(member),
      credentials: credentialsFor(member),
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That sales account was not found" });
    }
    console.error("getSalesMember error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- create */

/**
 * POST /api/sales/team
 *
 * Always creates a sales executive. The role is not read from the request, so
 * no body shape produces anything else. There is no ceiling on how many.
 */
export const createSalesMember = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!name) return res.status(400).json({ message: "Name is required" });
    if (!email) return res.status(400).json({ message: "Email is required" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "That does not look like an email address" });
    }

    const taken = await User.findOne({ email }).select("_id");
    if (taken) return res.status(409).json({ message: `An account already uses ${email}` });

    const { password, error } = resolvePassword(req.body, null);
    if (error) return res.status(400).json({ message: error });

    const member = await User.create({
      name,
      email,
      password: hashPassword(password),
      // Hardcoded. See the note at the top of this file.
      role: "sales_exec",
      /**
       * Whoever opened the account manages it. Not offered as a dropdown: a
       * manager adding somebody to "their team" and then having to pick which
       * team is a question with one sensible answer, and leaving it blank is
       * how an executive ends up on nobody's screen.
       */
      reportsTo: req.sales._id,
      phone: String(req.body.phone || "").trim(),
      designation: String(req.body.designation || "Sales Executive").trim(),
      department: String(req.body.department || "Sales").trim(),
      joiningDate: req.body.joiningDate || undefined,
      status: req.body.status === "inactive" ? "inactive" : "active",
    });

    logActivity(req, {
      action: "created",
      entity: "Sales account",
      entityId: member._id,
      message: `Sales executive login created for ${member.name}, reporting to ${req.sales.name}`,
    });

    return res.status(201).json({
      message: `${member.name} can now sign in to the Sales panel`,
      item: shape(member),
      credentials: {
        loginId: member.email,
        password,
        portal: "Sales panel",
        loginUrl: "/",
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "An account already uses that email" });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("createSalesMember error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- update */

// PUT /api/sales/team/:id
export const updateSalesMember = async (req, res) => {
  try {
    const member = await User.findOne({
      _id: req.params.id,
      ...teamFilterFor(req.sales),
    });
    if (!member) return res.status(404).json({ message: "That sales account was not found" });

    const isSelf = String(member._id) === String(req.sales._id);

    /**
     * Promotion and demotion between the two sales roles is allowed, with one
     * exception: the head may not demote themselves. Doing so leaves a panel
     * whose only privileged account has given the privilege away, with no way
     * back short of the database.
     */
    if (req.body.role !== undefined && req.body.role !== member.role) {
      const next = String(req.body.role).trim();
      if (!SALES_PANEL_ROLES.includes(next)) {
        return res.status(400).json({
          message: "A sales account is either the Sales head or a sales executive",
        });
      }
      if (isSelf && next !== SALES_ADMIN_ROLE) {
        return res.status(400).json({
          message: "You cannot remove your own Sales head access — promote somebody else first",
        });
      }
      member.role = next;
      // The role is baked into the token, so the old one has to stop working
      member.tokenVersion = (member.tokenVersion || 0) + 1;
    }

    if (req.body.email !== undefined) {
      const email = String(req.body.email).trim().toLowerCase();
      if (!email) return res.status(400).json({ message: "Email is required" });

      if (email !== member.email) {
        const taken = await User.findOne({ email, _id: { $ne: member._id } }).select("_id");
        if (taken) return res.status(409).json({ message: `An account already uses ${email}` });
        member.email = email;
        member.tokenVersion = (member.tokenVersion || 0) + 1;
      }
    }

    ["name", "designation", "department"].forEach((field) => {
      if (req.body[field] !== undefined) member[field] = String(req.body[field]).trim();
    });
    if (!member.name) return res.status(400).json({ message: "Name is required" });

    if (req.body.joiningDate !== undefined) {
      member.joiningDate = req.body.joiningDate || undefined;
    }

    const { password, error } = resolvePassword(req.body, member);
    if (error) return res.status(400).json({ message: error });

    if (req.body.phone !== undefined) member.phone = String(req.body.phone).trim();

    if (password) {
      member.password = hashPassword(password);
      member.tokenVersion = (member.tokenVersion || 0) + 1;
    }

    if (req.body.status !== undefined) {
      const status = req.body.status === "inactive" ? "inactive" : "active";

      if (status !== member.status) {
        if (status === "inactive" && isSelf) {
          return res.status(400).json({ message: "You cannot deactivate your own account" });
        }
        member.status = status;
        /**
         * Deactivating takes effect now, not whenever the token expires.
         * salesAuth already refuses an inactive account on the next request;
         * bumping the version makes the refusal immediate on every device.
         */
        member.tokenVersion = (member.tokenVersion || 0) + 1;
      }
    }

    await member.save();

    logActivity(req, {
      action: "updated",
      entity: "Sales account",
      entityId: member._id,
      message: `Sales account for ${member.name} updated`,
    });

    return res.status(200).json({
      message: "Account updated",
      item: shape(member),
      ...(password
        ? { credentials: { loginId: member.email, password, portal: "Sales panel" } }
        : {}),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "An account already uses that email" });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That sales account was not found" });
    }
    console.error("updateSalesMember error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- delete */

/**
 * DELETE /api/sales/team/:id
 *
 * Refused while the account still owns live deals. Deleting somebody mid-
 * pipeline orphans every lead they were carrying, and an orphaned lead is one
 * nobody is chasing — the reassignment has to happen first, deliberately.
 */
export const removeSalesMember = async (req, res) => {
  try {
    const member = await User.findOne({
      _id: req.params.id,
      ...teamFilterFor(req.sales),
    });
    if (!member) return res.status(404).json({ message: "That sales account was not found" });

    if (String(member._id) === String(req.sales._id)) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }

    if (member.role === SALES_ADMIN_ROLE) {
      const heads = await User.countDocuments({ role: SALES_ADMIN_ROLE });
      if (heads <= 1) {
        return res.status(400).json({
          message: "This is the only Sales head account — promote somebody else before deleting it",
        });
      }
    }

    const openLeads = await Lead.countDocuments({
      owner: member._id,
      stage: { $nin: ["won", "lost"] },
    });
    if (openLeads) {
      return res.status(400).json({
        message: `${member.name} still owns ${openLeads} open lead${
          openLeads === 1 ? "" : "s"
        } — reassign them first, or deactivate the account instead`,
      });
    }

    await member.deleteOne();

    logActivity(req, {
      action: "deleted",
      entity: "Sales account",
      entityId: member._id,
      message: `Sales account for ${member.name} deleted`,
    });

    return res.status(200).json({ message: `${member.name}'s sales account was deleted` });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That sales account was not found" });
    }
    console.error("removeSalesMember error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------------- claim */

/**
 * PUT /api/sales/team/:id/claim
 *
 * Take an unmanaged executive onto this manager's team.
 *
 * Every sales account opened before the reporting line existed has an empty
 * manager, and so does anyone HR onboards without saying whose team they join.
 * Without this they would sit in the unclaimed list forever, visible to every
 * manager and managed by none.
 *
 * Only an executive with no manager can be claimed. Somebody already on a
 * team is not available to be taken — moving a person between managers is a
 * conversation those two managers have, not a button one of them presses.
 */
export const claimSalesMember = async (req, res) => {
  try {
    const member = await User.findOne({
      _id: req.params.id,
      ...unclaimedTeamFilter(),
    });

    if (!member) {
      return res.status(404).json({
        message: "That account is not waiting to be claimed — it may already be on a team",
      });
    }

    member.reportsTo = req.sales._id;
    await member.save();

    logActivity(req, {
      action: "updated",
      entity: "Sales account",
      entityId: member._id,
      message: `${member.name} now reports to ${req.sales.name}`,
    });

    notifyUser(member._id, {
      type: "team",
      title: "You have a sales manager",
      message: `${req.sales.name} is now your manager. Work they assign you appears under My Tasks.`,
      link: "/sales/tasks",
    });

    return res.status(200).json({
      message: `${member.name} is now on your team`,
      item: shape(member),
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That sales account was not found" });
    }
    console.error("claimSalesMember error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/sales/people
 *
 * Just the names, for the "assign to" dropdown. Available to executives too —
 * handing a lead on is ordinary, and it is the only sales-team data an
 * executive can read.
 *
 * Scoped to this account's own circle: a manager gets their team, an
 * executive gets their manager and the colleagues beside them. Whoever is
 * returned here is exactly who a lead or a task may be handed to, and the
 * handlers check the same filter again rather than trusting the id that
 * comes back.
 */
export const salesTeamOptions = async (req, res) => {
  try {
    const members = await User.find({
      $and: [circleFilterFor(req.sales), { status: "active" }],
    })
      .select("name email role")
      .sort({ name: 1 });

    return res.status(200).json({ items: members });
  } catch (err) {
    console.error("salesTeamOptions error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
