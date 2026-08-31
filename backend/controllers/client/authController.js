import { signClientToken } from "../../utils/token.js";
import Client from "../../models/Client.js";
import Setting from "../../models/Setting.js";
import ActivityLog from "../../models/ActivityLog.js";
import { hashPassword, comparePassword } from "../../utils/password.js";

// Client tokens deliberately carry no `role` — that is how clientAuth tells
// them apart from staff tokens signed with the same secret.
const createToken = signClientToken;

const safeClient = (client) => ({
  id: client._id,
  name: client.name,
  company: client.company,
  email: client.email,
  phone: client.phone,
  address: client.address,
  gstNumber: client.gstNumber,
  status: client.status,
});

// Which optional chat tabs the admin has switched on.
const readFlags = async () => {
  const settings = await Setting.findOne({ key: "general" });
  return {
    leaderChatEnabled: Boolean(settings?.leaderClientChat),
    employeeChatEnabled: Boolean(settings?.employeeClientChat),
    companyName: settings?.companyName || "JHA Company",
  };
};

// POST /api/client/login
export const clientLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const client = await Client.findOne({ email: email.toLowerCase() });

    // A client with no password set has never been given portal access
    if (!client || !client.password || !comparePassword(password, client.password)) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!client.portalAccess || client.status === "inactive") {
      return res.status(403).json({ message: "Portal access is turned off for this account" });
    }

    client.lastLogin = new Date();
    await client.save();

    ActivityLog.create({
      actorName: client.name,
      action: "login",
      entity: "Client",
      entityId: client._id,
      message: `${client.name} (client) signed in to the portal`,
    }).catch((err) => console.error("client login log error:", err.message));

    return res.status(200).json({
      message: "Logged in successfully",
      token: createToken(client),
      client: safeClient(client),
      flags: await readFlags(),
    });
  } catch (err) {
    console.error("clientLogin error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/client/me
export const clientProfile = async (req, res) => {
  try {
    return res.status(200).json({ client: safeClient(req.client), flags: await readFlags() });
  } catch (err) {
    console.error("clientProfile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/client/profile
export const updateProfile = async (req, res) => {
  try {
    const { name, phone, address } = req.body;

    const client = await Client.findById(req.client._id);
    if (!client) return res.status(404).json({ message: "Account not found" });

    // Company, email and GST are contract details — the admin owns those.
    if (name !== undefined) client.name = name;
    if (phone !== undefined) client.phone = phone;
    if (address !== undefined) client.address = address;

    await client.save();

    return res.status(200).json({ message: "Profile updated", client: safeClient(client) });
  } catch (err) {
    console.error("client updateProfile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/client/profile/password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const client = await Client.findById(req.client._id);
    if (!client || !comparePassword(currentPassword, client.password)) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    client.password = hashPassword(newPassword);
    /**
     * A new password should mean every other device is signed out — that is
     * the whole point of changing one you think somebody else knows. Bumping
     * the version does that; minting a fresh token straight after is what
     * keeps the device doing the changing from being signed out too.
     */
    client.tokenVersion = (client.tokenVersion || 0) + 1;
    await client.save();

    return res
      .status(200)
      .json({ message: "Password changed successfully", token: createToken(client) });
  } catch (err) {
    console.error("client changePassword error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/client/logout
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
export const clientLogout = async (req, res) => {
  try {
    await Client.updateOne({ _id: req.client._id }, { $inc: { tokenVersion: 1 } });
  } catch (err) {
    console.error("clientLogout error:", err.message);
  }
  return res.status(200).json({ message: "Signed out" });
};
