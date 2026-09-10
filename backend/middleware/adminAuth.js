import jwt from "jsonwebtoken";
import User, { ADMIN_PANEL_ROLES } from "../models/User.js";

/**
 * Verify the bearer token and make sure the account may use the admin panel.
 *
 * A super admin passes here, and so does a department account — HR, Sales or
 * Operations. Getting through this door has never been the same question as
 * what somebody may then *do*, which is decided by the module guards; opening
 * it to departments changes who reaches those guards, not what they allow.
 *
 * A department account is never unrestricted on the other side of it. See
 * permissionsFor(), which resolves them against their department's access
 * before the "no role assigned means everything" branch can be reached.
 */
const adminAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "Not authorized", code: "AUTH" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (!user || !ADMIN_PANEL_ROLES.includes(user.role)) {
      return res.status(403).json({ message: "Admin access only", code: "AUTH" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ message: "This account is inactive", code: "AUTH" });
    }

    /**
     * The token was minted for a session that has since been ended — a
     * sign-out, a password change, or an admin resetting it. See
     * User.tokenVersion / Client.tokenVersion.
     */
    if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      return res
        .status(401)
        .json({ message: "This session has ended. Please sign in again.", code: "AUTH" });
    }

    req.admin = user;
    next();
  } catch (err) {
    console.error("adminAuth error:", err.message);
    return res.status(401).json({ message: "Invalid or expired token", code: "AUTH" });
  }
};

export default adminAuth;
