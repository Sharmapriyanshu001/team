import ActivityLog from "../../models/ActivityLog.js";
import Setting from "../../models/Setting.js";
import User, { DEPARTMENT_LABELS, HR_PANEL_ROLES } from "../../models/User.js";

import { logActivity } from "../../utils/activity.js";
import { comparePassword, hashPassword } from "../../utils/password.js";
import { hrPermissions, isHrAdmin } from "../../utils/hrAccess.js";
import { signStaffToken as createToken } from "../../utils/token.js";

/**
 * Signing in to the HR panel.
 *
 * The same account shape and the same token as every other panel — what
 * differs is which roles are let through, and that this token is refused by
 * adminAuth, leaderAuth and employeeAuth alike.
 */

const safeHr = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  roleLabel: DEPARTMENT_LABELS[user.role] || "HR",
  phone: user.phone,
  designation: user.designation,
  department: user.department,
  joiningDate: user.joiningDate,
});

/** What the panel needs to decide which screens to offer. */
const accessFor = (user) => ({
  isHrAdmin: isHrAdmin(user.role),
  modules: hrPermissions(user.role),
});

// POST /api/hr/login
export const hrLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user || !comparePassword(password, user.password)) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!HR_PANEL_ROLES.includes(user.role)) {
      return res.status(403).json({ message: "This account is not an HR account" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ message: "This account is inactive" });
    }

    const token = createToken(user);

    ActivityLog.create({
      actor: user._id,
      actorName: user.name,
      action: "login",
      entity: "HR",
      entityId: user._id,
      message: `${user.name} (${DEPARTMENT_LABELS[user.role] || "HR"}) logged in`,
    }).catch((err) => console.error("hr login log error:", err.message));

    return res.status(200).json({
      message: "Logged in successfully",
      token,
      hr: safeHr(user),
      access: accessFor(user),
    });
  } catch (err) {
    console.error("hrLogin error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/hr/me
export const hrProfile = async (req, res) =>
  res.status(200).json({ hr: safeHr(req.hr), access: accessFor(req.hr) });

/**
 * POST /api/hr/logout
 *
 * Bumping the version is what actually ends the session — a JWT cannot be
 * recalled, so every token minted before this moment stops matching. Answers
 * 200 even if the write fails: the person has already decided to leave and
 * there is nothing useful the browser could do with the error.
 */
export const hrLogout = async (req, res) => {
  try {
    await User.updateOne({ _id: req.hr._id }, { $inc: { tokenVersion: 1 } });
  } catch (err) {
    console.error("hrLogout error:", err.message);
  }
  return res.status(200).json({ message: "Signed out" });
};

// PUT /api/hr/profile
export const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.hr._id);
    if (!user) return res.status(404).json({ message: "Account not found" });

    // department joins the list so this panel's profile asks for exactly what
    // the admin one does — safeHr has always handed it back, it simply could
    // not be set from here
    ["name", "phone", "designation", "department"].forEach((field) => {
      if (req.body[field] !== undefined) user[field] = String(req.body[field]).trim();
    });

    await user.save();

    logActivity(req, {
      action: "updated",
      entity: "Profile",
      entityId: user._id,
      message: "HR profile updated",
    });

    return res.status(200).json({ message: "Profile updated", hr: safeHr(user) });
  } catch (err) {
    console.error("hr updateProfile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/hr/profile/password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const user = await User.findById(req.hr._id);
    if (!user || !comparePassword(currentPassword, user.password)) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    user.password = hashPassword(newPassword);
    /**
     * A new password should mean every other device is signed out — that is
     * the point of changing one you think somebody else knows. Bumping the
     * version does that; minting a fresh token straight after is what keeps
     * the device doing the changing from being signed out too.
     */
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    logActivity(req, {
      action: "updated",
      entity: "Profile",
      entityId: user._id,
      message: "HR password changed",
    });

    return res
      .status(200)
      .json({ message: "Password changed successfully", token: createToken(user) });
  } catch (err) {
    console.error("hr changePassword error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/hr/settings
 *
 * The company details HR needs on a letter or an offer, read-only — they are
 * the administrator's to set, and an HR panel that could rewrite the company's
 * GSTIN would be a surprising thing to have built.
 */
export const getSettings = async (req, res) => {
  try {
    const settings = await Setting.findOne({ key: "general" });

    return res.status(200).json({
      settings: {
        companyName: settings?.companyName || "",
        companyEmail: settings?.companyEmail || "",
        companyPhone: settings?.companyPhone || "",
        address: settings?.address || "",
        website: settings?.website || "",
        workingHours: settings?.workingHours || "",
        timezone: settings?.timezone || "",
        currency: settings?.currency || "INR",
      },
      editable: false,
    });
  } catch (err) {
    console.error("hr getSettings error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
