import User, { ADMIN_ROLES } from "../models/User.js";
import Role from "../models/Role.js";
import { logActivity } from "../utils/activity.js";
import { SUPER_ADMIN } from "../middleware/permissions.js";

/**
 * Managing the admin accounts themselves: who is a super admin, and which
 * permission role each plain admin holds.
 *
 * Super admin only, and written around one rule — it must be impossible to
 * end up with no super admin. A system whose last full-access account was
 * demoted by accident has no way back except the database.
 */

const shape = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  isSuperAdmin: user.role === SUPER_ADMIN,
  permissionRole: user.permissionRole || null,
});

const countSuperAdmins = (excludeId) =>
  User.countDocuments({
    role: SUPER_ADMIN,
    status: "active",
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });

/* -------------------------------------------------------------------- list */

// GET /api/admin/administrators
export const listAdministrators = async (req, res) => {
  try {
    const admins = await User.find({ role: { $in: ADMIN_ROLES } })
      .select("name email role status permissionRole")
      .populate("permissionRole", "name key")
      .sort({ role: 1, name: 1 });

    return res.status(200).json({
      administrators: admins.map(shape),
      superAdminCount: await countSuperAdmins(),
    });
  } catch (err) {
    console.error("listAdministrators error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------------ update */

// PUT /api/admin/administrators/:id   { isSuperAdmin, permissionRole }
export const updateAdministrator = async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target || !ADMIN_ROLES.includes(target.role)) {
      return res.status(404).json({ message: "Administrator not found" });
    }

    const changes = [];

    /* ---------------------------------------------------- super admin flag */

    if (req.body.isSuperAdmin !== undefined) {
      const wanted = req.body.isSuperAdmin === true || req.body.isSuperAdmin === "true";
      const isNow = target.role === SUPER_ADMIN;

      if (wanted !== isNow) {
        if (!wanted) {
          // Never let the last one go. Nobody could undo it afterwards.
          const others = await countSuperAdmins(target._id);
          if (others === 0) {
            return res.status(400).json({
              message: "This is the only super admin — promote somebody else first",
            });
          }
          if (String(target._id) === String(req.admin._id)) {
            return res.status(400).json({
              message: "You cannot remove your own super admin access",
            });
          }
        }

        target.role = wanted ? SUPER_ADMIN : "admin";
        changes.push(wanted ? "made a super admin" : "returned to admin");
      }
    }

    /* ------------------------------------------------------ permission role */

    if (req.body.permissionRole !== undefined) {
      const value = req.body.permissionRole;

      if (!value) {
        if (target.permissionRole) changes.push("permission role cleared");
        target.permissionRole = undefined;
      } else {
        const role = await Role.findById(value).select("name");
        if (!role) return res.status(400).json({ message: "That role does not exist" });

        if (String(target.permissionRole || "") !== String(role._id)) {
          changes.push(`permission role set to ${role.name}`);
        }
        target.permissionRole = role._id;
      }
    }

    if (!changes.length) {
      return res.status(200).json({ message: "Nothing to change", administrator: shape(target) });
    }

    await target.save();

    logActivity(req, {
      action: "updated",
      entity: "Administrator",
      entityId: target._id,
      message: `${req.admin.name}: ${target.name} ${changes.join(", ")}`,
    });

    const fresh = await User.findById(target._id)
      .select("name email role status permissionRole")
      .populate("permissionRole", "name key");

    return res.status(200).json({
      message: `${target.name} — ${changes.join(", ")}`,
      administrator: shape(fresh),
    });
  } catch (err) {
    console.error("updateAdministrator error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ----------------------------------------------- used by the roles routes */

/**
 * A role that somebody is using cannot be deleted. Without this, deleting a
 * role would leave its holders pointing at nothing — and permissionsFor()
 * fails closed on that, so it would lock them out rather than free them.
 */
export const roleIsInUse = async (roleId) =>
  User.countDocuments({ permissionRole: roleId });
