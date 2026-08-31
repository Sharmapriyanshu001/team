import Message from "../models/Message.js";
import User from "../models/User.js";
import Client from "../models/Client.js";
import Project from "../models/Project.js";
import { notifyUser, notifyClient } from "../utils/notify.js";
import { emitMessage } from "../utils/realtime.js";

// The admin's four tabs. Note that "employees" maps to the employee_admin
// scope — the leader keeps its own thread with each employee under "employee".
const SCOPE_SOURCES = {
  client: () =>
    Client.find({ status: { $ne: "inactive" } })
      .select("name company email")
      .sort({ name: 1 }),
  team_leader: () =>
    User.find({ role: "team_leader" }).select("name email designation").sort({ name: 1 }),
  employee_admin: () =>
    User.find({ role: "employee" }).select("name email designation").sort({ name: 1 }),
  project: () =>
    Project.find().select("name code status").sort({ createdAt: -1 }),
};

// GET /api/admin/chat/rooms/:scope
export const getRooms = async (req, res) => {
  try {
    const { scope } = req.params;
    const source = SCOPE_SOURCES[scope];
    if (!source) return res.status(400).json({ message: "Unknown chat scope" });

    const docs = await source();
    const ids = docs.map((d) => d._id);

    const lastMessages = await Message.aggregate([
      { $match: { scope, roomId: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$roomId",
          text: { $first: "$text" },
          createdAt: { $first: "$createdAt" },
          senderName: { $first: "$senderName" },
          count: { $sum: 1 },
        },
      },
    ]);

    const lastByRoom = lastMessages.reduce((acc, row) => {
      acc[String(row._id)] = row;
      return acc;
    }, {});

    const rooms = docs.map((doc) => {
      const last = lastByRoom[String(doc._id)];
      return {
        id: doc._id,
        name: doc.name,
        subtitle: doc.company || doc.designation || doc.code || doc.email || "",
        lastMessage: last?.text || "",
        lastMessageAt: last?.createdAt || null,
        lastSender: last?.senderName || "",
        messageCount: last?.count || 0,
      };
    });

    // Most recently active conversation first, then alphabetical
    rooms.sort((a, b) => {
      if (a.lastMessageAt && b.lastMessageAt)
        return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
      if (a.lastMessageAt) return -1;
      if (b.lastMessageAt) return 1;
      return a.name.localeCompare(b.name);
    });

    return res.status(200).json({ scope, rooms });
  } catch (err) {
    console.error("getRooms error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/admin/chat/:scope/:roomId
export const getMessages = async (req, res) => {
  try {
    const { scope, roomId } = req.params;
    if (!SCOPE_SOURCES[scope])
      return res.status(400).json({ message: "Unknown chat scope" });

    const messages = await Message.find({ scope, roomId }).sort({ createdAt: 1 }).limit(200);
    return res.status(200).json({ messages });
  } catch (err) {
    console.error("getMessages error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/admin/chat/:scope/:roomId  { text }
export const sendMessage = async (req, res) => {
  try {
    const { scope, roomId } = req.params;
    const text = (req.body.text || "").trim();

    if (!SCOPE_SOURCES[scope])
      return res.status(400).json({ message: "Unknown chat scope" });
    if (!text) return res.status(400).json({ message: "Message cannot be empty" });

    const message = await Message.create({
      scope,
      roomId,
      sender: req.admin._id,
      senderName: req.admin.name,
      text,
    });

    emitMessage(scope, roomId, message);

    // For staff scopes the room id is the person's own user id, so the other
    // side can be pinged straight away.
    const inboxLink = {
      team_leader: "/leader/chat/admin",
      employee_admin: "/employee/chat/admin",
    }[scope];

    if (inboxLink) {
      notifyUser(roomId, {
        type: "chat",
        title: `Message from ${req.admin.name}`,
        message: text.slice(0, 120),
        link: inboxLink,
      });
    } else if (scope === "client") {
      notifyClient(roomId, {
        type: "chat",
        title: `Message from ${req.admin.name}`,
        message: text.slice(0, 120),
        link: "/client/chat/admin",
      });
    }

    return res.status(201).json({ message: "Sent", data: message });
  } catch (err) {
    console.error("sendMessage error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
