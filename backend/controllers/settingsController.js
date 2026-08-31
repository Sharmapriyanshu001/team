import Setting from "../models/Setting.js";
import User from "../models/User.js";
import { hashPassword, comparePassword } from "../utils/password.js";
import { signStaffToken as createToken } from "../utils/token.js";
import { logActivity } from "../utils/activity.js";
import { emitChatPermissions } from "../utils/realtime.js";

const safeAdmin = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone,
  designation: user.designation,
  department: user.department,
});

// GET /api/admin/settings
export const getSettings = async (req, res) => {
  try {
    let settings = await Setting.findOne({ key: "general" });
    if (!settings) settings = await Setting.create({ key: "general" });
    return res.status(200).json({ settings });
  } catch (err) {
    console.error("getSettings error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/admin/settings
export const updateSettings = async (req, res) => {
  try {
    const payload = { ...req.body };
    delete payload._id;
    delete payload.key;

    const settings = await Setting.findOneAndUpdate(
      { key: "general" },
      { $set: payload },
      { new: true, upsert: true, runValidators: true }
    );

    logActivity(req, {
      action: "updated",
      entity: "Settings",
      message: "Company settings updated",
    });

    // Anyone with a chat tab open re-reads it, so a tab the admin just switched
    // off disappears (or a new one shows up) without a refresh.
    emitChatPermissions({
      leaderChatEnabled: Boolean(settings.leaderClientChat),
      employeeChatEnabled: Boolean(settings.employeeClientChat),
    });

    return res.status(200).json({ message: "Settings saved", settings });
  } catch (err) {
    console.error("updateSettings error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/admin/profile
export const updateProfile = async (req, res) => {
  try {
    const { name, phone, designation, department } = req.body;

    const user = await User.findById(req.admin._id);
    if (!user) return res.status(404).json({ message: "Admin not found" });

    if (name !== undefined) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (designation !== undefined) user.designation = designation;
    if (department !== undefined) user.department = department;

    await user.save();

    logActivity(req, {
      action: "updated",
      entity: "Profile",
      entityId: user._id,
      message: "Profile updated",
    });

    return res.status(200).json({ message: "Profile updated", admin: safeAdmin(user) });
  } catch (err) {
    console.error("updateProfile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/admin/profile/password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Current and new password are required" });
    }
    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: "New password must be at least 6 characters" });
    }

    const user = await User.findById(req.admin._id);
    if (!user || !comparePassword(currentPassword, user.password)) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    user.password = hashPassword(newPassword);
    /**
     * A new password should mean every other device is signed out — that is
     * the whole point of changing one you think somebody else knows. Bumping
     * the version does that; minting a fresh token straight after is what
     * keeps the device doing the changing from being signed out too.
     */
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    logActivity(req, {
      action: "updated",
      entity: "Profile",
      entityId: user._id,
      message: "Password changed",
    });

    return res
      .status(200)
      .json({ message: "Password changed successfully", token: createToken(user) });
  } catch (err) {
    console.error("changePassword error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
