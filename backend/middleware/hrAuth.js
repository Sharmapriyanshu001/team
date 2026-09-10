import jwt from "jsonwebtoken";

import User, { HR_ADMIN_ROLE, HR_PANEL_ROLES } from "../models/User.js";
import { hrCan } from "../utils/hrAccess.js";

/**
 * The HR panel's door.
 *
 * HR has its own panel, its own token and its own routes rather than a corner
 * of the admin one — which is what makes "HR only reaches HR" a fact about the
 * server's routing table rather than a permission somebody could widen by
 * mistake. There is no route under /api/hr that touches a lead, an invoice, a
 * project or the vault, so no configuration of anything can let an HR account
 * near them.
 *
 * The same token that opens this door is refused at /api/admin: adminAuth
 * checks ADMIN_PANEL_ROLES, and HR is deliberately not in it.
 */
const hrAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "Not authorized", code: "AUTH" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (!user || !HR_PANEL_ROLES.includes(user.role)) {
      return res.status(403).json({ message: "HR access only", code: "AUTH" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ message: "This account is inactive", code: "AUTH" });
    }

    /**
     * The token was minted for a session that has since been ended — a
     * sign-out, a password change, or the HR head deactivating the account.
     * See User.tokenVersion.
     */
    if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      return res
        .status(401)
        .json({ message: "This session has ended. Please sign in again.", code: "AUTH" });
    }

    req.hr = user;
    next();
  } catch (err) {
    console.error("hrAuth error:", err.message);
    return res.status(401).json({ message: "Invalid or expired token", code: "AUTH" });
  }
};

/**
 * Guard a route group by module, the way the admin panel's `guard` does — the
 * action comes from the HTTP verb, so a route added later cannot quietly miss
 * its check.
 */
const ACTION_BY_METHOD = {
  GET: "view",
  HEAD: "view",
  POST: "create",
  PUT: "edit",
  PATCH: "edit",
  DELETE: "delete",
};

export const hrGuard = (module) => (req, res, next) => {
  const action = ACTION_BY_METHOD[req.method] || "view";
  if (hrCan(req.hr?.role, module, action)) return next();

  return res.status(403).json({
    message: `Your HR account does not allow you to ${action} ${module.replace(/_/g, " ")}`,
    module,
    action,
  });
};

/**
 * Managing the HR logins themselves.
 *
 * Only the HR head. An HR Manager who could create HR accounts could create
 * another head, and the two roles would mean nothing by the afternoon — so
 * this is a role check rather than a permission, and it cannot be granted.
 */
export const requireHrAdmin = (req, res, next) => {
  if (req.hr?.role === HR_ADMIN_ROLE) return next();

  return res.status(403).json({
    message: "Only the HR head can manage HR accounts",
    module: "hr_managers",
  });
};

export default hrAuth;
