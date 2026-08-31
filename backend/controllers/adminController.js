import { signStaffToken } from "../utils/token.js";
import User, { ADMIN_ROLES } from "../models/User.js";
import ActivityLog from "../models/ActivityLog.js";
import { comparePassword } from "../utils/password.js";
import { permissionsFor, SUPER_ADMIN } from "../middleware/permissions.js";

const createToken = signStaffToken;

const safeAdmin = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone,
  designation: user.designation,
  department: user.department,
});

// POST /api/admin/login
export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !comparePassword(password, user.password)) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // A super admin signs in through the same door as an admin
    if (!ADMIN_ROLES.includes(user.role)) {
      return res.status(403).json({ message: "This account is not an admin" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ message: "This account is inactive" });
    }

    const token = createToken(user);

    ActivityLog.create({
      actor: user._id,
      actorName: user.name,
      action: "login",
      entity: "Admin",
      entityId: user._id,
      message: `${user.name} logged in`,
    }).catch((err) => console.error("login log error:", err.message));

    return res.status(200).json({
      message: "Logged in successfully",
      token,
      admin: safeAdmin(user),
    });
  } catch (err) {
    console.error("adminLogin error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/admin/me
 *
 * Also reports what this account may do, so the panel can leave out sections
 * it cannot use. That is presentation only — every route re-checks, and a
 * hand-typed URL gets the same 403 as a hidden link would have.
 */
export const adminProfile = async (req, res) => {
  const permissions = await permissionsFor(req);

  return res.status(200).json({
    admin: safeAdmin(req.admin),
    permissions: {
      isSuperAdmin: req.admin.role === SUPER_ADMIN,
      unrestricted: Boolean(permissions.unrestricted),
      modules: permissions.modules,
      roleName: permissions.roleName || "",
      problem: permissions.broken || "",
    },
  });
};

/**
 * POST /api/admin/logout
 *
 * Signing out used to be entirely a browser-side act: the panel dropped the
 * token from localStorage and navigated away. The token itself stayed valid
 * for the rest of its seven days, so anything that had a copy of it — a shared
 * machine, a stale tab, somebody who had lifted it — kept full access to the
 * account long after the person believed they had left.
 *
 * Bumping the version is what actually ends it. Every token minted before this
 * moment now fails the check in the auth middleware and in the socket
 * handshake, on every device at once.
 *
 * Answers 200 even if the write fails: the caller has already decided to leave
 * and there is nothing useful it could do with the error. The failure is
 * logged, which is where it belongs.
 */
export const adminLogout = async (req, res) => {
  try {
    await User.updateOne({ _id: req.admin._id }, { $inc: { tokenVersion: 1 } });
  } catch (err) {
    console.error("adminLogout error:", err.message);
  }
  return res.status(200).json({ message: "Signed out" });
};
