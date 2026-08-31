import Role from "../models/Role.js";

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
        level: "admin",
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
        level: "admin",
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

/** For the handful of actions only a super admin may take. */
export const requireSuperAdmin = (req, res, next) => {
  if (req.admin?.role === SUPER_ADMIN) return next();
  return res.status(403).json({ message: "Only a super admin can do that" });
};
