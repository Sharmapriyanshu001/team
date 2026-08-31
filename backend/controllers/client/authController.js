import jwt from "jsonwebtoken";
import Client from "../../models/Client.js";
import Setting from "../../models/Setting.js";
import ActivityLog from "../../models/ActivityLog.js";
import { hashPassword, comparePassword } from "../../utils/password.js";

// Client tokens deliberately carry no `role` — that is how clientAuth tells
// them apart from staff tokens signed with the same secret.
const createToken = (client) =>
  jwt.sign({ id: client._id, email: client.email }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

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
    await client.save();

    return res.status(200).json({ message: "Password changed successfully" });
  } catch (err) {
    console.error("client changePassword error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
