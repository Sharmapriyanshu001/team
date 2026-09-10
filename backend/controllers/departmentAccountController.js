import Role from "../models/Role.js";
import User, {
  ADMIN_ROLES,
  DEPARTMENT_LABELS,
  DEPARTMENT_ROLES,
} from "../models/User.js";

import { logActivity } from "../utils/activity.js";
import { comparePassword, hashPassword } from "../utils/password.js";
import {
  DEPARTMENT_OPTIONS,
  defaultPermissionsFor,
  portalFor,
} from "../utils/departmentAccess.js";

/**
 * The department logins: HR, Sales and Operations.
 *
 * There is no limit on how many of each may exist, and that is the point of
 * the module. A company with three HR people needs three HR accounts; one
 * shared login between them is one audit trail that says "HR" and never says
 * who. So these are ordinary User records with a department role, created the
 * same way and as often as needed.
 *
 * Two rules hold the module together:
 *
 *   only a full administrator may open it       enforced by requireFullAdmin
 *                                               on the routes, because an
 *                                               account that can mint accounts
 *                                               is not a restricted account
 *
 *   a department account is never unrestricted  enforced in permissionsFor,
 *                                               which resolves these roles
 *                                               against their department's
 *                                               access before it can reach the
 *                                               "no role means everything"
 *                                               branch that plain admins use
 */

const label = (role) => DEPARTMENT_LABELS[role] || role;

const shape = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  departmentLabel: label(user.role),
  phone: user.phone || "",
  designation: user.designation || "",
  department: user.department || "",
  status: user.status,
  joiningDate: user.joiningDate || null,
  permissionRole: user.permissionRole || null,
  lastUpdated: user.updatedAt,
  createdAt: user.createdAt,
});

/**
 * The password is the person's mobile number unless one is typed in — the same
 * rule every other account in this panel follows, so there is one answer to
 * "what is their password" rather than one per screen.
 */
const resolvePassword = (body, existing) => {
  const typed = String(body.password || "").trim();
  const phone = String(body.phone ?? existing?.phone ?? "").trim();

  if (typed) {
    if (typed.length < 6) {
      return { error: "Password must be at least 6 characters" };
    }
    return { password: typed };
  }

  if (!existing) {
    if (!phone) {
      return { error: "Enter a mobile number — it becomes the login password" };
    }
    if (phone.replace(/\D/g, "").length < 6) {
      return { error: "Mobile number looks too short to use as a password" };
    }
    return { password: phone };
  }

  // On an edit, leave the password alone unless the mobile number moved
  if (body.phone !== undefined && body.phone !== existing.phone && phone) {
    return { password: phone };
  }
  return { password: null };
};

/**
 * The stored password is a one-way hash and cannot be read back. What can be
 * done is test it against the default this panel hands out, so an admin can
 * still tell somebody their login rather than being forced to reset it.
 */
const credentialsFor = (user) => {
  const phone = (user.phone || "").trim();
  const isDefault = Boolean(user.password) && Boolean(phone) && comparePassword(phone, user.password);

  return {
    loginId: user.email,
    password: isDefault ? phone : null,
    isDefault,
    portal: portalFor(user.role),
  };
};

/* --------------------------------------------------------------- meta */

/**
 * GET /api/admin/department-accounts/meta
 *
 * What can be created and what each department reaches by default, so the form
 * does not carry its own copy of a list the server owns.
 */
export const departmentMeta = async (req, res) => {
  try {
    const roles = await Role.find().select("name key description").sort({ name: 1 });

    return res.status(200).json({
      departments: DEPARTMENT_OPTIONS.map((option) => ({
        ...option,
        // The actual permission map, so the form can show what "default
        // access" means instead of asking somebody to take it on faith
        permissions: defaultPermissionsFor(option.value),
      })),
      roles,
    });
  } catch (err) {
    console.error("departmentMeta error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- list */

// GET /api/admin/department-accounts?role=hr&status=active&search=
export const listDepartmentAccounts = async (req, res) => {
  try {
    const query = { role: { $in: DEPARTMENT_ROLES } };

    const role = String(req.query.role || "").trim();
    if (role && role !== "all") {
      if (!DEPARTMENT_ROLES.includes(role)) {
        return res.status(400).json({ message: "That is not a department" });
      }
      query.role = role;
    }

    const status = String(req.query.status || "").trim();
    if (status && status !== "all") query.status = status;

    const search = String(req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ name: regex }, { email: regex }, { phone: regex }, { designation: regex }];
    }

    const accounts = await User.find(query)
      .select("-password -documents -bank -previousEmployment")
      .populate("permissionRole", "name key")
      .sort({ role: 1, name: 1 });

    // Counts per department, unfiltered, so the tabs can show totals even
    // while one of them is being looked at
    const totals = await User.aggregate([
      { $match: { role: { $in: DEPARTMENT_ROLES } } },
      {
        $group: {
          _id: "$role",
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
        },
      },
    ]);

    const byDepartment = {};
    DEPARTMENT_ROLES.forEach((key) => {
      byDepartment[key] = { total: 0, active: 0, label: label(key) };
    });
    totals.forEach((row) => {
      byDepartment[row._id] = { total: row.total, active: row.active, label: label(row._id) };
    });

    return res.status(200).json({
      items: accounts.map((account) => ({
        ...shape(account),
        permissionRole: account.permissionRole || null,
      })),
      total: accounts.length,
      byDepartment,
    });
  } catch (err) {
    console.error("listDepartmentAccounts error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------- get one */

// GET /api/admin/department-accounts/:id
export const getDepartmentAccount = async (req, res) => {
  try {
    const account = await User.findOne({
      _id: req.params.id,
      role: { $in: DEPARTMENT_ROLES },
    }).populate("permissionRole", "name key permissions");

    if (!account) return res.status(404).json({ message: "Account not found" });

    return res.status(200).json({
      item: shape(account),
      credentials: credentialsFor(account),
      // What this account actually reaches right now — its assigned role if it
      // has one, otherwise its department's defaults
      access: account.permissionRole
        ? { source: "role", roleName: account.permissionRole.name }
        : { source: "department", modules: defaultPermissionsFor(account.role) },
    });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Account not found" });
    console.error("getDepartmentAccount error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- create */

/**
 * POST /api/admin/department-accounts
 *
 * Nothing here counts existing accounts before allowing another. Creating the
 * tenth HR login is the same operation as creating the first.
 */
export const createDepartmentAccount = async (req, res) => {
  try {
    const role = String(req.body.role || "").trim();
    if (!DEPARTMENT_ROLES.includes(role)) {
      return res.status(400).json({
        message: `Choose a department: ${DEPARTMENT_ROLES.map(label).join(", ")}`,
      });
    }

    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!name) return res.status(400).json({ message: "Name is required" });
    if (!email) return res.status(400).json({ message: "Email is required" });

    const taken = await User.findOne({ email }).select("_id role");
    if (taken) {
      return res.status(409).json({ message: `An account already uses ${email}` });
    }

    const { password, error } = resolvePassword(req.body, null);
    if (error) return res.status(400).json({ message: error });

    // An explicit role is allowed but never required — left off, the account
    // runs on its department's defaults, which is the ordinary case
    let permissionRole;
    if (req.body.permissionRole) {
      const found = await Role.findById(req.body.permissionRole).select("_id");
      if (!found) return res.status(400).json({ message: "That role does not exist" });
      permissionRole = found._id;
    }

    const account = await User.create({
      name,
      email,
      password: hashPassword(password),
      role,
      phone: String(req.body.phone || "").trim(),
      designation: String(req.body.designation || "").trim(),
      department: String(req.body.department || label(role)).trim(),
      joiningDate: req.body.joiningDate || undefined,
      status: req.body.status === "inactive" ? "inactive" : "active",
      permissionRole,
    });

    logActivity(req, {
      action: "created",
      entity: "Department account",
      entityId: account._id,
      message: `${label(role)} account created for ${account.name}`,
    });

    return res.status(201).json({
      message: `${label(role)} account created`,
      item: shape(account),
      credentials: { loginId: account.email, password, portal: portalFor(account.role) },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "An account already uses that email" });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("createDepartmentAccount error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- update */

// PUT /api/admin/department-accounts/:id
export const updateDepartmentAccount = async (req, res) => {
  try {
    const account = await User.findOne({
      _id: req.params.id,
      role: { $in: DEPARTMENT_ROLES },
    });
    if (!account) return res.status(404).json({ message: "Account not found" });

    /**
     * Moving somebody between departments is allowed — an HR person taking
     * over Operations is a real thing — but only ever between department
     * roles. This route must not become a way to make somebody an admin;
     * that lives behind requireSuperAdmin on the Administrators screen.
     */
    if (req.body.role !== undefined && req.body.role !== account.role) {
      const next = String(req.body.role).trim();
      if (!DEPARTMENT_ROLES.includes(next)) {
        return res.status(400).json({
          message: "A department account can only be moved to another department",
        });
      }
      account.role = next;
    }

    if (req.body.email !== undefined) {
      const email = String(req.body.email).trim().toLowerCase();
      if (!email) return res.status(400).json({ message: "Email is required" });

      if (email !== account.email) {
        const taken = await User.findOne({ email, _id: { $ne: account._id } }).select("_id");
        if (taken) return res.status(409).json({ message: `An account already uses ${email}` });
        account.email = email;
        // Changing the sign-in address ends the sessions signed in with the old
        // one, which is the same reasoning as a password reset.
        account.tokenVersion = (account.tokenVersion || 0) + 1;
      }
    }

    ["name", "designation", "department"].forEach((field) => {
      if (req.body[field] !== undefined) account[field] = String(req.body[field]).trim();
    });
    if (req.body.joiningDate !== undefined) {
      account.joiningDate = req.body.joiningDate || undefined;
    }

    const { password, error } = resolvePassword(req.body, account);
    if (error) return res.status(400).json({ message: error });

    if (req.body.phone !== undefined) account.phone = String(req.body.phone).trim();

    if (password) {
      account.password = hashPassword(password);
      /**
       * A reset is usually done because the old password should stop working.
       * Leaving the live tokens alone would make it cosmetic for another week.
       */
      account.tokenVersion = (account.tokenVersion || 0) + 1;
    }

    if (req.body.status !== undefined) {
      const status = req.body.status === "inactive" ? "inactive" : "active";
      if (status !== account.status) {
        account.status = status;
        // Deactivating has to take effect now, not when the token expires.
        // The auth middleware already refuses an inactive account, and this
        // makes the refusal immediate on every device at once.
        account.tokenVersion = (account.tokenVersion || 0) + 1;
      }
    }

    if (req.body.permissionRole !== undefined) {
      if (!req.body.permissionRole) {
        account.permissionRole = undefined;
      } else {
        const found = await Role.findById(req.body.permissionRole).select("_id");
        if (!found) return res.status(400).json({ message: "That role does not exist" });
        account.permissionRole = found._id;
      }
    }

    await account.save();

    logActivity(req, {
      action: "updated",
      entity: "Department account",
      entityId: account._id,
      message: `${label(account.role)} account for ${account.name} updated`,
    });

    return res.status(200).json({
      message: "Account updated",
      item: shape(account),
      ...(password
        ? { credentials: { loginId: account.email, password, portal: portalFor(account.role) } }
        : {}),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "An account already uses that email" });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    if (err.name === "CastError") return res.status(404).json({ message: "Account not found" });
    console.error("updateDepartmentAccount error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- delete */

/**
 * DELETE /api/admin/department-accounts/:id
 *
 * Deactivating is nearly always the right answer and the screen says so —
 * a deleted account takes its name off every record it decided on. But an
 * account created by mistake this morning should not have to be kept forever,
 * so deleting is allowed and logged.
 */
export const removeDepartmentAccount = async (req, res) => {
  try {
    const account = await User.findOne({
      _id: req.params.id,
      role: { $in: DEPARTMENT_ROLES },
    });
    if (!account) return res.status(404).json({ message: "Account not found" });

    if (String(account._id) === String(req.admin._id)) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }

    await account.deleteOne();

    logActivity(req, {
      action: "deleted",
      entity: "Department account",
      entityId: account._id,
      message: `${label(account.role)} account for ${account.name} deleted`,
    });

    return res.status(200).json({ message: `${account.name}'s account was deleted` });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Account not found" });
    console.error("removeDepartmentAccount error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** Used by the Administrators screen so both lists agree on what an admin is. */
export const isFullAdminRole = (role) => ADMIN_ROLES.includes(role);
