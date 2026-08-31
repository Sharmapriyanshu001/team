import jwt from "jsonwebtoken";
import User, { ADMIN_ROLES } from "../models/User.js";

/**
 * Verify the bearer token and make sure the account is an admin.
 *
 * A super admin passes here too. Getting through this door is unchanged from
 * before — what a plain admin may then *do* is decided by requirePermission,
 * which is a separate question asked separately.
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

    if (!user || !ADMIN_ROLES.includes(user.role)) {
      return res.status(403).json({ message: "Admin access only", code: "AUTH" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ message: "This account is inactive", code: "AUTH" });
    }

    req.admin = user;
    next();
  } catch (err) {
    console.error("adminAuth error:", err.message);
    return res.status(401).json({ message: "Invalid or expired token", code: "AUTH" });
  }
};

export default adminAuth;
