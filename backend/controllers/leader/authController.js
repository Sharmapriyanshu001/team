import jwt from "jsonwebtoken";
import User from "../../models/User.js";
import Setting from "../../models/Setting.js";
import ActivityLog from "../../models/ActivityLog.js";
import { hashPassword, comparePassword } from "../../utils/password.js";

const createToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

const safeLeader = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone,
  designation: user.designation,
  department: user.department,
  joiningDate: user.joiningDate,
});

// Feature flags the sidebar needs (client chat is admin-controlled).
const readFlags = async () => {
  const settings = await Setting.findOne({ key: "general" });
  return { clientChatEnabled: Boolean(settings?.leaderClientChat) };
};

// POST /api/leader/login
export const leaderLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !comparePassword(password, user.password)) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (user.role !== "team_leader") {
      return res.status(403).json({ message: "This account is not a team leader" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ message: "This account is inactive" });
    }

    const token = createToken(user);

    ActivityLog.create({
      actor: user._id,
      actorName: user.name,
      action: "login",
      entity: "Team Leader",
      entityId: user._id,
      message: `${user.name} (team leader) logged in`,
    }).catch((err) => console.error("leader login log error:", err.message));

    return res.status(200).json({
      message: "Logged in successfully",
      token,
      leader: safeLeader(user),
      flags: await readFlags(),
    });
  } catch (err) {
    console.error("leaderLogin error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/leader/me
export const leaderProfile = async (req, res) => {
  try {
    return res.status(200).json({
      leader: safeLeader(req.leader),
      flags: await readFlags(),
    });
  } catch (err) {
    console.error("leaderProfile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/leader/profile
export const updateProfile = async (req, res) => {
  try {
    const { name, phone, designation } = req.body;

    const user = await User.findById(req.leader._id);
    if (!user) return res.status(404).json({ message: "Account not found" });

    // Department and role stay under the admin's control.
    if (name !== undefined) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (designation !== undefined) user.designation = designation;

    await user.save();

    return res.status(200).json({ message: "Profile updated", leader: safeLeader(user) });
  } catch (err) {
    console.error("leader updateProfile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/leader/profile/password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const user = await User.findById(req.leader._id);
    if (!user || !comparePassword(currentPassword, user.password)) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    user.password = hashPassword(newPassword);
    await user.save();

    return res.status(200).json({ message: "Password changed successfully" });
  } catch (err) {
    console.error("leader changePassword error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
