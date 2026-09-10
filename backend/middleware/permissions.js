import Role from "../models/Role.js";
import { ADMIN_ROLES, DEPARTMENT_LABELS } from "../models/User.js";
import { defaultPermissionsFor, isDepartmentRole } from "../utils/departmentAccess.js";

/**
 * Module-level permissions for admin accounts.
 *
 * The Role model and its editor screen already existed; nothing read them.
 * This is what makes them mean something — carefully, because switching a
 * dormant permission system on is exactly the kind of change that locks
 * everybody out of a working app.
 *
 * Three rules, in order:
 *
 *   super admin            never checked, always allowed
 *   admin with no role     allowed everything, which is precisely how every
 *                          admin behaved before this file existed
 *   admin with a role      allowed exactly what that role grants
 *
 * The middle rule is the important one. Existing accounts have no role
 * assigned, so this change is invisible to them until somebody deliberately
 * assigns one.
 */

export const SUPER_ADMIN = "super_admin";

/** REST verb to the permission it needs. */
const ACTION_BY_METHOD = {
  GET: "view",
  HEAD: "view",
  POST: "create",
  PUT: "edit",
  PATCH: "edit",
  DELETE: "delete",
};

/**
 * Work out what this admin may do. Cached on the request so a handler that
 * asks twice only costs one lookup.
 */
export const permissionsFor = async (req) => {
  if (req.permissions) return req.permissions;

  const user = req.admin;
  let resolved;

  if (!user) {
    resolved = { level: "none", unrestricted: false, modules: {} };
  } else if (user.role === SUPER_ADMIN) {
    resolved = { level: SUPER_ADMIN, unrestricted: true, modules: {}, roleName: "Super Admin" };
  } else if (!user.permissionRole && isDepartmentRole(user.role)) {
    /**
     * A department account with no role attached. It gets its department's
     * defaults — never the unrestricted branch below, which exists so that
     * admins who predate this system kept working and would make a brand new
     * HR account a second super admin.
     *
     * Checked before the "no role" branch precisely so it cannot fall through.
     */
    resolved = {
      level: "department",
      department: user.role,
      unrestricted: false,
      modules: defaultPermissionsFor(user.role),
      roleName: `${DEPARTMENT_LABELS[user.role]} (default access)`,
    };
  } else if (!user.permissionRole) {
    resolved = { level: "admin", unrestricted: true, modules: {}, roleName: "" };
  } else {
    const role = await Role.findById(user.permissionRole).select("name key permissions");

    if (!role) {
      /**
       * The role was deleted out from under this account. Failing open here
       * would turn "delete a role" into "silently promote everyone who had
       * it", so it fails closed — and deleting an assigned role is refused
       * elsewhere, so this should stay theoretical.
       */
      resolved = {
        level: isDepartmentRole(user.role) ? "department" : "admin",
        department: isDepartmentRole(user.role) ? user.role : undefined,
        unrestricted: false,
        modules: {},
        broken: "The role assigned to your account no longer exists — ask a super admin to fix it",
      };
    } else {
      // Mongoose Maps do not spread, so the plain object is built explicitly
      const modules = {};
      for (const [module, actions] of role.permissions || new Map()) {
        modules[module] = Array.isArray(actions) ? actions : [];
      }
      resolved = {
        level: isDepartmentRole(user.role) ? "department" : "admin",
        department: isDepartmentRole(user.role) ? user.role : undefined,
        unrestricted: false,
        modules,
        roleName: role.name,
        roleKey: role.key,
      };
    }
  }

  req.permissions = resolved;
  return resolved;
};

/** Does this admin hold `action` on `module`? */
export const can = (permissions, module, action) => {
  if (!permissions) return false;
  if (permissions.unrestricted) return true;
  if (permissions.broken) return false;
  return (permissions.modules[module] || []).includes(action);
};

/**
 * Guard a whole route group. The action comes from the HTTP verb, so a route
 * cannot be added later and quietly miss its check — mounting the guard on the
 * path covers everything under it, including routes that do not exist yet.
 */
export const guard = (module) => async (req, res, next) => {
  try {
    const permissions = await permissionsFor(req);

    if (permissions.broken) {
      return res.status(403).json({ message: permissions.broken });
    }

    const action = ACTION_BY_METHOD[req.method] || "view";
    if (can(permissions, module, action)) return next();

    const readable = module.replace(/_/g, " ");
    return res.status(403).json({
      message: `Your role does not allow you to ${action} ${readable}`,
      module,
      action,
    });
  } catch (err) {
    console.error("permission guard error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * The same check, but for a route whose HTTP verb does not describe what it
 * does.
 *
 * Revealing a vault secret is the case this exists for: it is a POST, because
 * a GET would be prefetched and logged with its URL, but what it performs is a
 * read. Left to the verb it would demand "create" on the vault — so an admin
 * granted view-only would be told their role does not allow them to *create*
 * vault entries, when all they did was click Reveal.
 */
export const guardAction = (module, action) => async (req, res, next) => {
  try {
    const permissions = await permissionsFor(req);

    if (permissions.broken) return res.status(403).json({ message: permissions.broken });
    if (can(permissions, module, action)) return next();

    const readable = module.replace(/_/g, " ");
    return res.status(403).json({
      message: `Your role does not allow you to ${action} ${readable}`,
      module,
      action,
    });
  } catch (err) {
    console.error("permission guard error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** For the handful of actions only a super admin may take. */
export const requireSuperAdmin = (req, res, next) => {
  if (req.admin?.role === SUPER_ADMIN) return next();
  return res.status(403).json({ message: "Only a super admin can do that" });
};

/**
 * For actions a department account must never reach however its role is
 * configured.
 *
 * The module guards are the ordinary control and they are enough for data.
 * This is for the two places where being wrong is unrecoverable — editing the
 * roles themselves, and creating the department logins — because a department
 * account that can grant itself a module is not restricted by anything.
 */
export const requireFullAdmin = (req, res, next) => {
  if (ADMIN_ROLES.includes(req.admin?.role)) return next();
  return res
    .status(403)
    .json({ message: "Only an administrator can do that", module: "department_accounts" });
};
