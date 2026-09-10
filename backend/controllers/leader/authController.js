import { signStaffToken } from "../../utils/token.js";
import User, { LEADER_ROLES } from "../../models/User.js";
import Setting from "../../models/Setting.js";
import ActivityLog from "../../models/ActivityLog.js";
import { hashPassword, comparePassword } from "../../utils/password.js";

const createToken = signStaffToken;

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

    /**
     * A department manager signs in here too. They are not an administrator —
     * they answer for a team's numbers — so the leader panel is the right
     * place for them, widened to their whole department by leaderAuth's scope.
     */
    if (!LEADER_ROLES.includes(user.role)) {
      return res.status(403).json({ message: "This account is not an operations manager" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ message: "This account is inactive" });
    }

    const token = createToken(user);

    ActivityLog.create({
      actor: user._id,
      actorName: user.name,
      action: "login",
      entity: "Operations Manager",
      entityId: user._id,
      message: `${user.name} (operations manager) logged in`,
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
    console.error("leader changePassword error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/leader/logout
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
export const leaderLogout = async (req, res) => {
  try {
    await User.updateOne({ _id: req.leader._id }, { $inc: { tokenVersion: 1 } });
  } catch (err) {
    console.error("leaderLogout error:", err.message);
  }
  return res.status(200).json({ message: "Signed out" });
};
