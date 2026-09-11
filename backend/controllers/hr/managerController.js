import User, {
  DEPARTMENT_LABELS,
  HR_ADMIN_ROLE,
  HR_PANEL_ROLES,
} from "../../models/User.js";

import { logActivity } from "../../utils/activity.js";
import { hashPassword } from "../../utils/password.js";
import { credentialsFor as readCredentials, resolvePassword } from "../../utils/staffPassword.js";

/**
 * The HR team's own logins.
 *
 * The HR head creates and manages their colleagues here, and there is no
 * ceiling on how many: three HR people need three logins, because one shared
 * account is an audit trail that says "HR" and never says who approved the
 * leave. The database was found enforcing a ceiling of exactly one through a
 * unique index on users.role — utils/dbGuards.js removes it on every boot.
 *
 * One rule holds the module together, and it is enforced here rather than
 * trusted to the form:
 *
 *   an account created from this screen is ALWAYS "hr_manager"
 *
 * The role never comes from the request. If it did, an HR Manager who found
 * their way past requireHrAdmin — or an HR head with a modified client — could
 * mint an admin, a super admin, or a second head, and the whole two-tier
 * arrangement would be decoration. The one role this screen can produce is the
 * one below the person using it.
 */

const shape = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  roleLabel: DEPARTMENT_LABELS[user.role] || "HR",
  isHead: user.role === HR_ADMIN_ROLE,
  phone: user.phone || "",
  designation: user.designation || "",
  status: user.status,
  joiningDate: user.joiningDate || null,
  lastUpdated: user.updatedAt,
  createdAt: user.createdAt,
});

/**
 * What to store and what to show — both from utils/staffPassword, which is the
 * one place that knows the starting password this system hands out.
 */
const credentialsFor = (user) => readCredentials(user, "HR panel");

/* --------------------------------------------------------------- list */

// GET /api/hr/managers
export const listManagers = async (req, res) => {
  try {
    const query = { role: { $in: HR_PANEL_ROLES } };

    const status = String(req.query.status || "").trim();
    if (status && status !== "all") query.status = status;

    const search = String(req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ name: regex }, { email: regex }, { phone: regex }, { designation: regex }];
    }

    const [team, totals] = await Promise.all([
      User.find(query)
        .select("-password -documents -bank -previousEmployment")
        .sort({ role: 1, name: 1 }),
      User.aggregate([
        { $match: { role: { $in: HR_PANEL_ROLES } } },
        {
          $group: {
            _id: "$role",
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const byRole = { hr: { total: 0, active: 0 }, hr_manager: { total: 0, active: 0 } };
    totals.forEach((row) => {
      byRole[row._id] = { total: row.total, active: row.active };
    });

    return res.status(200).json({
      items: team.map(shape),
      total: team.length,
      byRole,
      // So the screen can say why the delete button is missing on one row
      youAre: req.hr.role,
      yourId: req.hr._id,
    });
  } catch (err) {
    console.error("listManagers error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/hr/managers/:id
export const getManager = async (req, res) => {
  try {
    const person = await User.findOne({ _id: req.params.id, role: { $in: HR_PANEL_ROLES } });
    if (!person) return res.status(404).json({ message: "Account not found" });

    return res
      .status(200)
      .json({ item: shape(person), credentials: credentialsFor(person) });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Account not found" });
    console.error("getManager error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- create */

/**
 * POST /api/hr/managers
 *
 * Nothing here counts existing accounts before allowing another — creating the
 * tenth HR Manager is the same operation as creating the first.
 */
export const createManager = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!name) return res.status(400).json({ message: "Name is required" });
    if (!email) return res.status(400).json({ message: "Email is required" });

    const taken = await User.findOne({ email }).select("_id");
    if (taken) return res.status(409).json({ message: `An account already uses ${email}` });

    const { password, error } = resolvePassword(req.body, null);
    if (error) return res.status(400).json({ message: error });

    const person = await User.create({
      name,
      email,
      password: hashPassword(password),
      /**
       * Never from the request. This screen makes HR Managers and nothing
       * else — see the note at the top of this file.
       */
      role: "hr_manager",
      phone: String(req.body.phone || "").trim(),
      designation: String(req.body.designation || "HR Manager").trim(),
      department: DEPARTMENT_LABELS.hr,
      joiningDate: req.body.joiningDate || undefined,
      status: req.body.status === "inactive" ? "inactive" : "active",
    });

    logActivity(req, {
      action: "created",
      entity: "HR Manager",
      entityId: person._id,
      message: `${req.hr.name} created an HR Manager login for ${person.name}`,
    });

    return res.status(201).json({
      message: `${person.name} can now sign in to the HR panel`,
      item: shape(person),
      credentials: { loginId: person.email, password },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "An account already uses that email" });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("createManager error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- update */

// PUT /api/hr/managers/:id
export const updateManager = async (req, res) => {
  try {
    const person = await User.findOne({ _id: req.params.id, role: { $in: HR_PANEL_ROLES } });
    if (!person) return res.status(404).json({ message: "Account not found" });

    /**
     * The head is not editable from here, by anybody including themselves.
     *
     * Their own details are theirs to change under Settings; what this stops
     * is the head being deactivated or renamed through the team screen, which
     * is the one action that could leave the HR panel with nobody able to
     * manage it. An administrator can still fix anything from their own panel.
     */
    if (person.role === HR_ADMIN_ROLE) {
      return res.status(403).json({
        message:
          String(person._id) === String(req.hr._id)
            ? "Change your own details under Settings"
            : "The HR head's account is managed by an administrator",
      });
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

    ["name", "designation"].forEach((field) => {
      if (req.body[field] !== undefined) person[field] = String(req.body[field]).trim();
    });
    if (req.body.joiningDate !== undefined) {
      person.joiningDate = req.body.joiningDate || undefined;
    }

    const { password, error } = resolvePassword(req.body, person);
    if (error) return res.status(400).json({ message: error });

    if (req.body.phone !== undefined) person.phone = String(req.body.phone).trim();

    if (password) {
      person.password = hashPassword(password);
      /**
       * A reset is usually done because the old password should stop working.
       * Leaving the live tokens alone would make it cosmetic for another week.
       */
      person.tokenVersion = (person.tokenVersion || 0) + 1;
    }

    if (req.body.status !== undefined) {
      const status = req.body.status === "inactive" ? "inactive" : "active";
      if (status !== person.status) {
        person.status = status;
        // Deactivating has to take effect now, not when the token expires
        person.tokenVersion = (person.tokenVersion || 0) + 1;
      }
    }

    await person.save();

    logActivity(req, {
      action: "updated",
      entity: "HR Manager",
      entityId: person._id,
      message: `${req.hr.name} updated the HR Manager login for ${person.name}`,
    });

    return res.status(200).json({
      message: "Account updated",
      item: shape(person),
      ...(password ? { credentials: { loginId: person.email, password } } : {}),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "An account already uses that email" });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    if (err.name === "CastError") return res.status(404).json({ message: "Account not found" });
    console.error("updateManager error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- delete */

/**
 * DELETE /api/hr/managers/:id
 *
 * Deactivating is nearly always the right answer and the screen says so — a
 * deleted account takes its name off every leave it ever decided. But an
 * account created by mistake this morning should not have to be kept forever.
 */
export const removeManager = async (req, res) => {
  try {
    const person = await User.findOne({ _id: req.params.id, role: { $in: HR_PANEL_ROLES } });
    if (!person) return res.status(404).json({ message: "Account not found" });

    if (person.role === HR_ADMIN_ROLE) {
      return res.status(403).json({ message: "The HR head's account cannot be deleted here" });
    }
    if (String(person._id) === String(req.hr._id)) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }

    await person.deleteOne();

    logActivity(req, {
      action: "deleted",
      entity: "HR Manager",
      entityId: person._id,
      message: `${req.hr.name} deleted the HR Manager login for ${person.name}`,
    });

    return res.status(200).json({ message: `${person.name}'s login was deleted` });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Account not found" });
    console.error("removeManager error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
