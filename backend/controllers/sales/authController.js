import ActivityLog from "../../models/ActivityLog.js";
import User, {
  DEPARTMENT_LABELS,
  SALES_ADMIN_ROLE,
  SALES_PANEL_ROLES,
} from "../../models/User.js";

import { comparePassword, hashPassword } from "../../utils/password.js";
import { signStaffToken } from "../../utils/token.js";
import { SALES_MODULES, salesPermissionsFor } from "../../utils/salesAccess.js";

/**
 * Signing in to the Sales panel, and the account's own profile.
 *
 * A separate door from /api/admin/login on purpose. The same person could be
 * refused there and admitted here, and that is the point: what an account may
 * reach is decided by which panel will mint it a token, not by what the
 * browser chooses to render.
 */

const safeSales = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone || "",
  designation: user.designation || "",
  department: user.department || "",
  joiningDate: user.joiningDate || null,
  isSalesHead: user.role === SALES_ADMIN_ROLE,
  roleLabel: DEPARTMENT_LABELS[user.role] || "Sales",

  /**
   * What HR recorded about the job when the account was opened.
   *
   * Sent with the account rather than fetched from a second screen, because
   * every one of these is the answer to a question the panel itself asks —
   * "whose targets are these", "how many people am I counting", "what am I
   * supposed to be handling". A record HR fills in that the person it
   * describes never sees is a record that goes stale.
   */
  employeeId: user.employeeId || "",
  workLocation: user.workLocation || "",
  employmentType: user.employmentType || "",
  salesRole: user.salesRole || "",
  teamSize: user.teamSize || 0,
  responsibilities: user.responsibilities || [],
  skills: user.skills || [],
  address: user.address || "",
  reportsTo: user.reportsTo?._id || user.reportsTo || null,
  reportsToName: user.reportsTo?.name || "",
});

// POST /api/sales/login
export const salesLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });

    /**
     * One message for "no such account" and for "wrong password" — telling
     * them apart is how an address list gets confirmed one try at a time.
     */
    if (!user || !comparePassword(password, user.password)) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!SALES_PANEL_ROLES.includes(user.role)) {
      return res.status(403).json({ message: "This account cannot use the Sales panel" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ message: "This account is inactive" });
    }

    const token = signStaffToken(user);

    ActivityLog.create({
      actor: user._id,
      actorName: user.name,
      action: "login",
      entity: "Sales",
      entityId: user._id,
      message: `${user.name} signed in to the Sales panel`,
    }).catch((err) => console.error("sales login log error:", err.message));

    return res.status(200).json({
      message: "Logged in successfully",
      token,
      sales: safeSales(user),
    });
  } catch (err) {
    console.error("salesLogin error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/sales/me
 *
 * What this account is and what it may do. The modules list is what the
 * sidebar is built from — presentation only, since every route checks again,
 * and the row-level scoping is enforced in the queries regardless.
 */
export const salesProfile = async (req, res) => {
  /**
   * The reporting line is the one field on the account that is an id rather
   * than a value, so it is the one that needs a lookup to mean anything on a
   * screen. Only done when there is one — most accounts answer to the admin
   * and pay nothing for this.
   */
  if (req.sales.reportsTo) {
    try {
      await req.sales.populate("reportsTo", "name designation");
    } catch {
      // A name that could not be resolved is not a reason to fail the profile
    }
  }

  return res.status(200).json({
    sales: safeSales(req.sales),
    permissions: {
      ...salesPermissionsFor(req.sales),
      allModules: SALES_MODULES,
      /**
       * Whether this account sees the whole pipeline or only its own rows.
       * The panel uses it for wording — "Team pipeline" against "My pipeline"
       * — never to decide what to fetch.
       */
      scope: req.sales.role === SALES_ADMIN_ROLE ? "team" : "own",
    },
  });
};

/**
 * PUT /api/sales/me
 *
 * The account editing itself. Deliberately narrow: name, phone, designation.
 * Role and status are absent — an executive promoting themselves is exactly
 * what this panel's one privileged route exists to prevent.
 */
export const updateSalesProfile = async (req, res) => {
  try {
    const user = await User.findById(req.sales._id);
    if (!user) return res.status(404).json({ message: "Account not found" });

    ["name", "phone", "designation", "address"].forEach((field) => {
      if (req.body[field] !== undefined) user[field] = String(req.body[field]).trim();
    });

    /**
     * Their skills are theirs to keep current; their responsibilities are not.
     *
     * The difference is who decided it. A skill is something the person
     * brought and is the one thing on this record they know better than HR
     * does. A responsibility is an assignment — letting somebody give
     * themselves "Sales Target & Team Management" would make the field mean
     * nothing on the day it mattered. Same reasoning as role and status being
     * absent from this route.
     */
    if (req.body.skills !== undefined) {
      const raw = Array.isArray(req.body.skills)
        ? req.body.skills
        : String(req.body.skills || "").split(",");

      const seen = new Set();
      user.skills = raw
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => {
          if (!entry || seen.has(entry.toLowerCase())) return false;
          seen.add(entry.toLowerCase());
          return true;
        });
    }

    if (!user.name) return res.status(400).json({ message: "Name is required" });

    await user.save();

    return res.status(200).json({ message: "Profile updated", sales: safeSales(user) });
  } catch (err) {
    console.error("updateSalesProfile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * PUT /api/sales/me/password
 *
 * Changing your own password, which requires proving you know the old one —
 * otherwise a machine left unlocked is an account taken over.
 */
export const changeSalesPassword = async (req, res) => {
  try {
    const current = String(req.body.currentPassword || "");
    const next = String(req.body.newPassword || "");

    if (!current || !next) {
      return res.status(400).json({ message: "Enter your current and new password" });
    }
    if (next.length < 6) {
      return res.status(400).json({ message: "The new password must be at least 6 characters" });
    }

    const user = await User.findById(req.sales._id);
    if (!user) return res.status(404).json({ message: "Account not found" });

    if (!comparePassword(current, user.password)) {
      return res.status(401).json({ message: "That is not your current password" });
    }

    user.password = hashPassword(next);

    /**
     * Every other session for this account stops working. The device doing the
     * changing is handed a fresh token below so it alone stays signed in,
     * which is what somebody expects when they change a password because they
     * think it is known.
     */
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    return res.status(200).json({
      message: "Password changed. Other devices have been signed out.",
      token: signStaffToken(user),
    });
  } catch (err) {
    console.error("changeSalesPassword error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/sales/logout
 *
 * Bumping the version is what actually ends the session — dropping the token
 * in the browser leaves it valid for the rest of its seven days everywhere
 * else it exists. Answers 200 either way: the person has decided to leave.
 */
export const salesLogout = async (req, res) => {
  try {
    await User.updateOne({ _id: req.sales._id }, { $inc: { tokenVersion: 1 } });
  } catch (err) {
    console.error("salesLogout error:", err.message);
  }
  return res.status(200).json({ message: "Signed out" });
};
