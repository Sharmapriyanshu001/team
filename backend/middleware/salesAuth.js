import jwt from "jsonwebtoken";

import User, { SALES_ADMIN_ROLE, SALES_PANEL_ROLES } from "../models/User.js";
import { salesCan, scopeFor } from "../utils/salesAccess.js";

/**
 * The Sales panel's door.
 *
 * Sales has a panel of its own rather than a corner of the admin one, and this
 * is what makes that mean something. An account signing in here must hold a
 * sales role; an admin token, an HR token or an operations manager's token is refused
 * outright, and a sales token is refused by every other panel's middleware for
 * the same reason. Isolation by separate doors, not by hidden menu items.
 *
 * Two roles pass:
 *
 *   sales        the Sales head — the whole pipeline, assigns leads, and the
 *                only account that may create or manage other sales logins
 *   sales_exec   an executive — the same screens, scoped to their own leads
 *
 * Getting through this door has never been the same question as which rows a
 * request may then touch. That is `req.salesScope`, resolved once here and
 * applied by every handler.
 */
const salesAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "Not authorized", code: "AUTH" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (!user || !SALES_PANEL_ROLES.includes(user.role)) {
      return res.status(403).json({ message: "Sales access only", code: "AUTH" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ message: "This account is inactive", code: "AUTH" });
    }

    /**
     * The token was minted for a session that has since been ended — a
     * sign-out, a password change, a deactivation, or the head resetting it.
     */
    if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      return res
        .status(401)
        .json({ message: "This session has ended. Please sign in again.", code: "AUTH" });
    }

    req.sales = user;

    /**
     * Which rows this request may touch, resolved once. Every list, detail and
     * write in this panel spreads one of these fragments into its query — see
     * utils/salesAccess.js for why they are query fragments rather than a flag
     * each handler has to remember to act on.
     */
    req.salesScope = scopeFor(user);

    next();
  } catch (err) {
    console.error("salesAuth error:", err.message);
    return res.status(401).json({ message: "Invalid or expired token", code: "AUTH" });
  }
};

/** REST verb to the permission it needs. Same mapping the admin panel uses. */
const ACTION_BY_METHOD = {
  GET: "view",
  HEAD: "view",
  POST: "create",
  PUT: "edit",
  PATCH: "edit",
  DELETE: "delete",
};

/**
 * Guard a route group by module. Mounted on the path rather than per route, so
 * a route added under one of these later cannot quietly miss its check.
 *
 * This is the coarse control — which screens exist for this role. The fine one
 * is req.salesScope, which decides which rows those screens return.
 */
export const salesGuard = (module) => (req, res, next) => {
  const action = ACTION_BY_METHOD[req.method] || "view";
  if (salesCan(req.sales, module, action)) return next();

  const readable = module.replace(/_/g, " ");
  return res.status(403).json({
    message: `Your role does not allow you to ${action} ${readable}`,
    module,
    action,
  });
};

/**
 * For the handful of routes where the verb does not describe what happens —
 * converting a lead is a POST that edits, reassigning is an edit that only a
 * head may make.
 */
export const salesGuardAction = (module, action) => (req, res, next) => {
  if (salesCan(req.sales, module, action)) return next();

  return res.status(403).json({
    message: `Your role does not allow you to ${action} ${module.replace(/_/g, " ")}`,
    module,
    action,
  });
};

/**
 * For the sales-team screens.
 *
 * Creating a login is handing somebody the pipeline. An executive holds their
 * own deals already, so this is not about trust in them; it is that an account
 * able to create accounts cannot be restricted by anything, and a panel should
 * have exactly one role that can.
 */
export const requireSalesHead = (req, res, next) => {
  if (req.sales?.role === SALES_ADMIN_ROLE) return next();

  return res.status(403).json({
    message: "Only the Sales head can do that",
    module: "team",
  });
};

export default salesAuth;
