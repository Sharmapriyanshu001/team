import Lead from "../../models/Lead.js";
import User, {
  DEPARTMENT_LABELS,
  EMPLOYMENT_TYPES,
  SALES_ADMIN_ROLE,
  SALES_PANEL_ROLES,
  WORK_LOCATIONS,
  WORK_RESPONSIBILITIES,
} from "../../models/User.js";

import { logActivity } from "../../utils/activity.js";
import { hashPassword } from "../../utils/password.js";
import { credentialsFor as readCredentials, resolvePassword } from "../../utils/staffPassword.js";

/**
 * Sales logins, opened and managed from the HR panel.
 *
 * HR onboards people; a Sales Manager is a person being onboarded. Until now
 * only an administrator could open one, which meant every sales hire went
 * through the admin whether or not anything about it needed an administrator's
 * judgement — and HR, whose job it is, could not.
 *
 * These are the same accounts the admin creates from Department Accounts and
 * the same ones the Sales panel's own team screen manages. One kind of record,
 * three doors onto it, so an account opened here behaves identically to one
 * opened anywhere else. That is the point of not writing a fourth definition
 * of what a sales account is.
 *
 * WHAT THIS ROUTE WILL AND WILL NOT MINT
 *
 * The role is validated against SALES_PANEL_ROLES and nothing else, so no
 * request body reaches an administrator, an HR role or an operations account
 * through here. Sales Manager is the default because that is what the screen
 * is for; an executive can be opened too, since HR onboarding the whole team
 * at once is the ordinary case.
 *
 * Worth stating plainly: whoever opens an account knows its first password, so
 * this route hands HR the ability to sign in to the Sales panel as the account
 * it just created. That is inherent to issuing credentials — it is equally
 * true of the administrator — and the control is the audit trail rather than a
 * refusal. Every create, edit, reset and deletion below is logged with the
 * name of whoever did it.
 */

const label = (role) => DEPARTMENT_LABELS[role] || "Sales";

/* ------------------------------------------------------- the profile bits */

const text = (value) => String(value ?? "").trim();

/**
 * A list that arrives as a real array over JSON, as one comma-separated string
 * from a plain form, and as several repeated fields over multipart — all three
 * mean the same thing, so all three are read the same way.
 *
 * Trimmed, emptied entries dropped, and de-duplicated case-insensitively:
 * "SEO" and "seo " are one responsibility, and storing both would show the
 * chip twice on every screen that prints them.
 */
const list = (value) => {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  const seen = new Set();
  const out = [];

  raw.forEach((entry) => {
    const item = text(entry);
    if (!item) return;

    const key = item.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    out.push(item);
  });

  return out;
};

/** One of the choices, or nothing. An unknown value is not stored as one. */
const oneOf = (value, allowed) => {
  const wanted = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  return allowed.includes(wanted) ? wanted : "";
};

/**
 * The company's own code for somebody, checked for being theirs alone.
 *
 * There is no unique index behind it — most existing rows have no employee id
 * at all, and an index over a field that is empty everywhere is a migration
 * nobody asked for. The check lives here instead, which means it is advisory
 * under a race and correct in every real case: two people are not given the
 * same code in the same millisecond by two HR accounts.
 */
const employeeIdTaken = async (employeeId, exceptId) => {
  if (!employeeId) return false;

  const clash = await User.findOne({
    employeeId,
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  }).select("_id name");

  return clash || false;
};

/**
 * The fields that describe the job rather than the login, folded onto a record.
 *
 * Shared by create and update so the two cannot drift — every one of them is
 * only written when the request actually carried it, which is what lets an
 * edit that changes a phone number leave the skills alone.
 */
const applyProfile = (person, body) => {
  if (body.workLocation !== undefined) {
    person.workLocation = oneOf(body.workLocation, WORK_LOCATIONS);
  }
  if (body.employmentType !== undefined) {
    person.employmentType = oneOf(body.employmentType, EMPLOYMENT_TYPES);
  }
  if (body.salesRole !== undefined) person.salesRole = text(body.salesRole);
  if (body.address !== undefined) person.address = text(body.address);

  if (body.teamSize !== undefined) {
    const size = Number(body.teamSize);
    person.teamSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : 0;
  }

  if (body.responsibilities !== undefined) person.responsibilities = list(body.responsibilities);
  if (body.skills !== undefined) person.skills = list(body.skills);

  /**
   * Who they answer to. An empty string is a deliberate "nobody" and has to
   * clear the field rather than be ignored, or a reporting line could be set
   * and never removed.
   */
  if (body.reportsTo !== undefined) {
    person.reportsTo = text(body.reportsTo) || undefined;
  }
};

const shape = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  roleLabel: label(user.role),
  isSalesHead: user.role === SALES_ADMIN_ROLE,
  phone: user.phone || "",
  designation: user.designation || "",
  department: user.department || "",
  status: user.status,
  joiningDate: user.joiningDate || null,
  createdAt: user.createdAt,

  /* what the job actually is — see WORK_RESPONSIBILITIES on the model */
  employeeId: user.employeeId || "",
  workLocation: user.workLocation || "",
  employmentType: user.employmentType || "",
  salesRole: user.salesRole || "",
  teamSize: user.teamSize || 0,
  responsibilities: user.responsibilities || [],
  skills: user.skills || [],
  address: user.address || "",

  /**
   * Populated where the caller asked for it, a bare id where it did not — so
   * a screen that wants the name gets it without every list paying for a join.
   */
  reportsTo: user.reportsTo?._id || user.reportsTo || null,
  reportsToName: user.reportsTo?.name || "",
});

/** The suggested lists, sent with the screen so the form and the model agree. */
export const salesManagerChoices = {
  workLocations: WORK_LOCATIONS,
  employmentTypes: EMPLOYMENT_TYPES,
  responsibilities: WORK_RESPONSIBILITIES,
};

/**
 * What to store and what to show — both from utils/staffPassword, which is the
 * one place that knows the starting password this system hands out.
 */
const credentialsFor = (user) => ({
  ...readCredentials(user, "Sales panel"),
  loginUrl: "/",
});

/** Sales Manager unless an executive was explicitly asked for. */
const resolveRole = (value) => {
  const role = String(value || SALES_ADMIN_ROLE).trim();
  return SALES_PANEL_ROLES.includes(role) ? role : null;
};

const ROLE_CHOICE_MESSAGE =
  "A sales account is either a Sales Manager or a sales executive";

/* ---------------------------------------------------------------- list */

// GET /api/hr/sales-managers?status=&role=&search=
export const listSalesManagers = async (req, res) => {
  try {
    const query = { role: { $in: SALES_PANEL_ROLES } };

    const status = String(req.query.status || "").trim();
    if (status && status !== "all") query.status = status;

    const role = String(req.query.role || "").trim();
    if (role && role !== "all") {
      const resolved = resolveRole(role);
      if (!resolved) return res.status(400).json({ message: "That is not a sales role" });
      query.role = resolved;
    }

    const search = String(req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ name: regex }, { email: regex }, { phone: regex }, { designation: regex }];
    }

    const people = await User.find(query)
      .select("-password -documents -bank -previousEmployment")
      .populate("reportsTo", "name designation")
      .sort({ role: 1, name: 1 });

    /**
     * How much each of them is carrying. HR is not running the pipeline, but
     * "can this person be deactivated today" is an HR question and the honest
     * answer depends on whether anybody is mid-deal with them.
     */
    const openByOwner = await Lead.aggregate([
      { $match: { owner: { $in: people.map((p) => p._id) }, stage: { $nin: ["won", "lost"] } } },
      { $group: { _id: "$owner", open: { $sum: 1 } } },
    ]);

    const openLeads = {};
    openByOwner.forEach((row) => {
      openLeads[String(row._id)] = row.open;
    });

    const [total, active] = await Promise.all([
      User.countDocuments({ role: { $in: SALES_PANEL_ROLES } }),
      User.countDocuments({ role: { $in: SALES_PANEL_ROLES }, status: "active" }),
    ]);

    return res.status(200).json({
      items: people.map((p) => ({ ...shape(p), openLeads: openLeads[String(p._id)] || 0 })),
      total: people.length,
      counts: { total, active, inactive: total - active, limit: null },
      choices: salesManagerChoices,
    });
  } catch (err) {
    console.error("listSalesManagers error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- get one */

// GET /api/hr/sales-managers/:id
export const getSalesManager = async (req, res) => {
  try {
    const person = await User.findOne({
      _id: req.params.id,
      role: { $in: SALES_PANEL_ROLES },
    })
      .select("-documents -bank -previousEmployment")
      .populate("reportsTo", "name designation");

    if (!person) return res.status(404).json({ message: "That sales account was not found" });

    return res.status(200).json({
      item: shape(person),
      credentials: credentialsFor(person),
      choices: salesManagerChoices,
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That sales account was not found" });
    }
    console.error("getSalesManager error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- create */

/**
 * POST /api/hr/sales-managers
 *
 * No ceiling on how many. A company with two Sales Managers running two
 * territories is an ordinary thing, and a system that allows exactly one is a
 * system somebody works around by sharing a password.
 */
export const createSalesManager = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!name) return res.status(400).json({ message: "Name is required" });
    if (!email) return res.status(400).json({ message: "Email is required" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "That does not look like an email address" });
    }

    const role = resolveRole(req.body.role);
    if (!role) return res.status(400).json({ message: ROLE_CHOICE_MESSAGE });

    const taken = await User.findOne({ email }).select("_id");
    if (taken) return res.status(409).json({ message: `An account already uses ${email}` });

    const { password, error } = resolvePassword(req.body, null);
    if (error) return res.status(400).json({ message: error });

    const employeeId = text(req.body.employeeId).toUpperCase();
    const clash = await employeeIdTaken(employeeId);
    if (clash) {
      return res.status(409).json({ message: `${clash.name} already has employee ID ${employeeId}` });
    }

    const person = new User({
      name,
      email,
      password: hashPassword(password),
      role,
      phone: String(req.body.phone || "").trim(),
      designation: String(
        req.body.designation || (role === SALES_ADMIN_ROLE ? "Sales Manager" : "Sales Executive")
      ).trim(),
      department: String(req.body.department || "Sales").trim(),
      joiningDate: req.body.joiningDate || undefined,
      status: req.body.status === "inactive" ? "inactive" : "active",
      employeeId,
    });

    /**
     * The job itself, in the same shape an edit writes it. Built on the
     * document before it is saved rather than passed to create(), so there is
     * exactly one place that decides what "field sales" or a list of skills
     * means on the way in.
     */
    applyProfile(person, req.body);

    await person.save();

    logActivity(req, {
      action: "created",
      entity: "Sales account",
      entityId: person._id,
      message: `${label(role)} login created for ${person.name} by HR`,
    });

    return res.status(201).json({
      message: `${person.name} can now sign in to the Sales panel`,
      item: shape(person),
      credentials: {
        loginId: person.email,
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
    console.error("createSalesManager error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- update */

// PUT /api/hr/sales-managers/:id
export const updateSalesManager = async (req, res) => {
  try {
    const person = await User.findOne({
      _id: req.params.id,
      role: { $in: SALES_PANEL_ROLES },
    });
    if (!person) return res.status(404).json({ message: "That sales account was not found" });

    /**
     * Moving somebody between the two sales roles is allowed — promoting an
     * executive is exactly the kind of thing HR does — but only ever between
     * sales roles. This route must not become a way to make somebody an
     * administrator or an HR account.
     */
    if (req.body.role !== undefined && req.body.role !== person.role) {
      const next = resolveRole(req.body.role);
      if (!next) return res.status(400).json({ message: ROLE_CHOICE_MESSAGE });

      /**
       * Demoting the last Sales Manager leaves a panel nobody can administer:
       * the sales team screen answers only to a head, so there would be no
       * account able to open another one.
       */
      if (person.role === SALES_ADMIN_ROLE && next !== SALES_ADMIN_ROLE) {
        const heads = await User.countDocuments({ role: SALES_ADMIN_ROLE, status: "active" });
        if (heads <= 1) {
          return res.status(400).json({
            message:
              "This is the only active Sales Manager — promote somebody else before demoting them",
          });
        }
      }

      person.role = next;
      // The role is baked into the token, so the old one has to stop working
      person.tokenVersion = (person.tokenVersion || 0) + 1;
    }

    if (req.body.email !== undefined) {
      const email = String(req.body.email).trim().toLowerCase();
      if (!email) return res.status(400).json({ message: "Email is required" });

      if (email !== person.email) {
        const taken = await User.findOne({ email, _id: { $ne: person._id } }).select("_id");
        if (taken) return res.status(409).json({ message: `An account already uses ${email}` });
        person.email = email;
        // Changing the sign-in address ends sessions signed in with the old one
        person.tokenVersion = (person.tokenVersion || 0) + 1;
      }
    }

    ["name", "designation", "department"].forEach((field) => {
      if (req.body[field] !== undefined) person[field] = String(req.body[field]).trim();
    });
    if (!person.name) return res.status(400).json({ message: "Name is required" });

    if (req.body.employeeId !== undefined) {
      const employeeId = text(req.body.employeeId).toUpperCase();
      const clash = await employeeIdTaken(employeeId, person._id);
      if (clash) {
        return res
          .status(409)
          .json({ message: `${clash.name} already has employee ID ${employeeId}` });
      }
      person.employeeId = employeeId;
    }

    applyProfile(person, req.body);

    if (req.body.joiningDate !== undefined) {
      person.joiningDate = req.body.joiningDate || undefined;
    }

    const { password, error } = resolvePassword(req.body, person);
    if (error) return res.status(400).json({ message: error });

    if (req.body.phone !== undefined) person.phone = String(req.body.phone).trim();

    if (password) {
      person.password = hashPassword(password);
      // A reset is done because the old password should stop working; leaving
      // live tokens alone would make it cosmetic for another week.
      person.tokenVersion = (person.tokenVersion || 0) + 1;
    }

    if (req.body.status !== undefined) {
      const status = req.body.status === "inactive" ? "inactive" : "active";

      if (status !== person.status) {
        /**
         * Deactivating the last active Sales Manager locks the panel the same
         * way demoting them would, so it is refused for the same reason.
         */
        if (status === "inactive" && person.role === SALES_ADMIN_ROLE) {
          const heads = await User.countDocuments({ role: SALES_ADMIN_ROLE, status: "active" });
          if (heads <= 1) {
            return res.status(400).json({
              message: "This is the only active Sales Manager — the Sales panel would be left with none",
            });
          }
        }

        person.status = status;
        /**
         * Deactivating takes effect now, not whenever the token expires.
         * salesAuth already refuses an inactive account on its next request;
         * bumping the version makes the refusal immediate on every device.
         */
        person.tokenVersion = (person.tokenVersion || 0) + 1;
      }
    }

    await person.save();
    await person.populate("reportsTo", "name designation");

    logActivity(req, {
      action: "updated",
      entity: "Sales account",
      entityId: person._id,
      message: `${label(person.role)} account for ${person.name} updated by HR`,
    });

    return res.status(200).json({
      message: "Account updated",
      item: shape(person),
      ...(password
        ? { credentials: { loginId: person.email, password, portal: "Sales panel" } }
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
    console.error("updateSalesManager error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- delete */

/**
 * DELETE /api/hr/sales-managers/:id
 *
 * Refused while the account still owns live deals. Deleting somebody
 * mid-pipeline orphans every lead they were carrying, and an orphaned lead is
 * one nobody is chasing — the reassignment has to happen first, deliberately,
 * from the Sales panel where the pipeline is visible.
 */
export const removeSalesManager = async (req, res) => {
  try {
    const person = await User.findOne({
      _id: req.params.id,
      role: { $in: SALES_PANEL_ROLES },
    });
    if (!person) return res.status(404).json({ message: "That sales account was not found" });

    if (person.role === SALES_ADMIN_ROLE) {
      const heads = await User.countDocuments({ role: SALES_ADMIN_ROLE });
      if (heads <= 1) {
        return res.status(400).json({
          message: "This is the only Sales Manager — appoint another one before deleting this account",
        });
      }
    }

    const openLeads = await Lead.countDocuments({
      owner: person._id,
      stage: { $nin: ["won", "lost"] },
    });
    if (openLeads) {
      return res.status(400).json({
        message: `${person.name} still owns ${openLeads} open lead${
          openLeads === 1 ? "" : "s"
        } — reassign them in the Sales panel first, or deactivate this account instead`,
      });
    }

    await person.deleteOne();

    logActivity(req, {
      action: "deleted",
      entity: "Sales account",
      entityId: person._id,
      message: `${label(person.role)} account for ${person.name} deleted by HR`,
    });

    return res.status(200).json({ message: `${person.name}'s sales account was deleted` });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That sales account was not found" });
    }
    console.error("removeSalesManager error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
