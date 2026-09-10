import mongoose from "mongoose";
import Message from "../../models/Message.js";
import User, { ADMIN_ROLES } from "../../models/User.js";
import Client from "../../models/Client.js";
import Project from "../../models/Project.js";
import Setting from "../../models/Setting.js";
import { getScope } from "../../middleware/leaderAuth.js";
import { notifyUser, notifyUsers, notifyClient } from "../../utils/notify.js";
import { emitMessage } from "../../utils/realtime.js";

/**
 * The leader's three tabs map onto the shared Message collection:
 *   admin    -> scope "operations_manager", room = the leader's own id (their thread
 *               with the admin, the same one the admin panel opens)
 *   employee -> scope "employee",      room = one of their team members
 *   client   -> scope "client_leader", room = a client on one of their projects
 */
const clientChatEnabled = async () => {
  const settings = await Setting.findOne({ key: "general" });
  return Boolean(settings?.leaderClientChat);
};

// Rooms the leader is allowed to open, per tab.
const resolveRooms = async (req, tab) => {
  if (tab === "admin") {
    const admin = await User.findOne({ role: { $in: ADMIN_ROLES } }).select("name email");
    return {
      scope: "operations_manager",
      rooms: [
        {
          id: req.leader._id,
          name: admin?.name || "Administrator",
          subtitle: admin?.email || "Admin team",
        },
      ],
    };
  }

  if (tab === "employee") {
    const { teamIds } = await getScope(req);
    const members = await User.find({ _id: { $in: teamIds } })
      .select("name email designation")
      .sort({ name: 1 });

    return {
      scope: "employee",
      rooms: members.map((m) => ({
        id: m._id,
        name: m.name,
        subtitle: m.designation || m.email,
      })),
    };
  }

  if (tab === "client") {
    if (!(await clientChatEnabled())) return { disabled: true };

    const { projectIds } = await getScope(req);
    const clientIds = await Project.find({ _id: { $in: projectIds } }).distinct("client");
    const clients = await Client.find({ _id: { $in: clientIds.filter(Boolean) } })
      .select("name company email")
      .sort({ name: 1 });

    return {
      scope: "client_leader",
      rooms: clients.map((c) => ({
        id: c._id,
        name: c.name,
        subtitle: c.company || c.email,
      })),
    };
  }

  return null;
};

// GET /api/leader/chat/rooms/:tab
export const getRooms = async (req, res) => {
  try {
    const resolved = await resolveRooms(req, req.params.tab);
    if (!resolved) return res.status(400).json({ message: "Unknown chat tab" });
    if (resolved.disabled) {
      return res.status(403).json({ message: "Client chat is turned off by the admin" });
    }

    const ids = resolved.rooms.map((r) => r.id);

    const lastMessages = await Message.aggregate([
      { $match: { scope: resolved.scope, roomId: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$roomId",
          text: { $first: "$text" },
          createdAt: { $first: "$createdAt" },
          senderName: { $first: "$senderName" },
        },
      },
    ]);

    const lastByRoom = lastMessages.reduce((acc, row) => {
      acc[String(row._id)] = row;
      return acc;
    }, {});

    const rooms = resolved.rooms.map((room) => {
      const last = lastByRoom[String(room.id)];
      return {
        ...room,
        lastMessage: last?.text || "",
        lastMessageAt: last?.createdAt || null,
        lastSender: last?.senderName || "",
      };
    });

    rooms.sort((a, b) => {
      if (a.lastMessageAt && b.lastMessageAt)
        return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
      if (a.lastMessageAt) return -1;
      if (b.lastMessageAt) return 1;
      return a.name.localeCompare(b.name);
    });

    return res.status(200).json({ tab: req.params.tab, scope: resolved.scope, rooms });
  } catch (err) {
    console.error("leader getRooms error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// Confirm the leader may open this particular room before touching messages.
const authoriseRoom = async (req) => {
  const resolved = await resolveRooms(req, req.params.tab);
  if (!resolved) return { error: [400, "Unknown chat tab"] };
  if (resolved.disabled) return { error: [403, "Client chat is turned off by the admin"] };

  if (!mongoose.isValidObjectId(req.params.roomId)) {
    return { error: [400, "Invalid conversation"] };
  }
  if (!resolved.rooms.some((room) => String(room.id) === String(req.params.roomId))) {
    return { error: [403, "That conversation is not yours"] };
  }

  return { scope: resolved.scope };
};

// GET /api/leader/chat/:tab/:roomId
export const getMessages = async (req, res) => {
  try {
    const { scope, error } = await authoriseRoom(req);
    if (error) return res.status(error[0]).json({ message: error[1] });

    const messages = await Message.find({ scope, roomId: req.params.roomId })
      .sort({ createdAt: 1 })
      .limit(200);

    return res.status(200).json({ messages });
  } catch (err) {
    console.error("leader getMessages error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/leader/chat/:tab/:roomId  { text }
export const sendMessage = async (req, res) => {
  try {
    const { scope, error } = await authoriseRoom(req);
    if (error) return res.status(error[0]).json({ message: error[1] });

    const text = (req.body.text || "").trim();
    if (!text) return res.status(400).json({ message: "Message cannot be empty" });

    const message = await Message.create({
      scope,
      roomId: req.params.roomId,
      sender: req.leader._id,
      senderName: req.leader.name,
      text,
      readByAdmin: false,
    });

    emitMessage(scope, req.params.roomId, message);

    // Ping the other side, in their own panel
    if (req.params.tab === "employee") {
      notifyUser(req.params.roomId, {
        type: "chat",
        title: `Message from ${req.leader.name}`,
        message: text.slice(0, 120),
        link: "/employee/chat/operation-manager",
      });
    } else if (req.params.tab === "client") {
      notifyClient(req.params.roomId, {
        type: "chat",
        title: `Message from ${req.leader.name}`,
        message: text.slice(0, 120),
        link: "/client/chat/operation-manager",
      });
    } else if (req.params.tab === "admin") {
      /**
       * This branch did not exist, so a leader writing to the admin was the
       * one message in the app that pinged nobody — the admin found out by
       * happening to open the thread. The client's and the employee's
       * messages to the admin have always notified; this one now matches.
       */
      const admins = await User.find({ role: { $in: ADMIN_ROLES } }).distinct("_id");
      notifyUsers(admins, {
        type: "chat",
        title: `Message from ${req.leader.name}`,
        message: text.slice(0, 120),
        link: "/admin/chat/operations-managers",
      });
    }

    return res.status(201).json({ message: "Sent", data: message });
  } catch (err) {
    console.error("leader sendMessage error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
