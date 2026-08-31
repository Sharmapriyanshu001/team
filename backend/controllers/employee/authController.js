import { signStaffToken } from "../../utils/token.js";
import User from "../../models/User.js";
import Setting from "../../models/Setting.js";
import ActivityLog from "../../models/ActivityLog.js";
import { hashPassword, comparePassword } from "../../utils/password.js";

const createToken = signStaffToken;

const safeEmployee = (user, leader) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone,
  designation: user.designation,
  department: user.department,
  joiningDate: user.joiningDate,
  teamLeader: leader ? { id: leader._id, name: leader.name, email: leader.email } : null,
});

const readFlags = async () => {
  const settings = await Setting.findOne({ key: "general" });
  return { clientChatEnabled: Boolean(settings?.employeeClientChat) };
};

// POST /api/employee/login
export const employeeLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !comparePassword(password, user.password)) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (user.role !== "employee") {
      return res.status(403).json({ message: "This account is not an employee" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ message: "This account is inactive" });
    }

    const leader = user.reportsTo
      ? await User.findById(user.reportsTo).select("name email")
      : null;

    ActivityLog.create({
      actor: user._id,
      actorName: user.name,
      action: "login",
      entity: "Employee",
      entityId: user._id,
      message: `${user.name} (employee) logged in`,
    }).catch((err) => console.error("employee login log error:", err.message));

    return res.status(200).json({
      message: "Logged in successfully",
      token: createToken(user),
      employee: safeEmployee(user, leader),
      flags: await readFlags(),
    });
  } catch (err) {
    console.error("employeeLogin error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/employee/me
export const employeeProfile = async (req, res) => {
  try {
    const leader = req.employee.reportsTo
      ? await User.findById(req.employee.reportsTo).select("name email")
      : null;

    return res.status(200).json({
      employee: safeEmployee(req.employee, leader),
      flags: await readFlags(),
    });
  } catch (err) {
    console.error("employeeProfile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/employee/profile
export const updateProfile = async (req, res) => {
  try {
    const { name, phone } = req.body;

    const user = await User.findById(req.employee._id);
    if (!user) return res.status(404).json({ message: "Account not found" });

    // Designation, department and reporting line stay with the admin.
    if (name !== undefined) user.name = name;
    if (phone !== undefined) user.phone = phone;

    await user.save();

    const leader = user.reportsTo ? await User.findById(user.reportsTo).select("name email") : null;

    return res.status(200).json({ message: "Profile updated", employee: safeEmployee(user, leader) });
  } catch (err) {
    console.error("employee updateProfile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/employee/profile/password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const user = await User.findById(req.employee._id);
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

    return res
      .status(200)
      .json({ message: "Password changed successfully", token: createToken(user) });
  } catch (err) {
    console.error("employee changePassword error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/employee/logout
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
export const employeeLogout = async (req, res) => {
  try {
    await User.updateOne({ _id: req.employee._id }, { $inc: { tokenVersion: 1 } });
  } catch (err) {
    console.error("employeeLogout error:", err.message);
  }
  return res.status(200).json({ message: "Signed out" });
};
