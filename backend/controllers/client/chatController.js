import mongoose from "mongoose";
import Message from "../../models/Message.js";
import User, { ADMIN_ROLES } from "../../models/User.js";
import Project from "../../models/Project.js";
import Setting from "../../models/Setting.js";
import { getScope } from "../../middleware/clientAuth.js";
import { notifyUsers } from "../../utils/notify.js";
import { emitMessage } from "../../utils/realtime.js";

/**
 * The client's three tabs, each a separate thread keyed on their own id:
 *   admin        -> scope "client"
 *   team_leader  -> scope "client_leader"    (only if the admin enabled it)
 *   employees    -> scope "client_employee"  (only if the admin enabled it)
 */
const readFlags = async () => {
  const settings = await Setting.findOne({ key: "general" });
  return {
    leaderChatEnabled: Boolean(settings?.leaderClientChat),
    employeeChatEnabled: Boolean(settings?.employeeClientChat),
  };
};

const resolveRooms = async (req, tab) => {
  const flags = await readFlags();

  if (tab === "admin") {
    const admin = await User.findOne({ role: { $in: ADMIN_ROLES } }).select("name email");
    return {
      scope: "client",
      rooms: [
        {
          id: req.client._id,
          name: admin?.name || "Administrator",
          subtitle: admin?.email || "Admin team",
        },
      ],
    };
  }

  if (tab === "team_leader") {
    if (!flags.leaderChatEnabled) return { disabled: true };

    const { projectIds } = await getScope(req);
    const leaderIds = await Project.find({ _id: { $in: projectIds } }).distinct("teamLeader");
    const leaders = await User.find({ _id: { $in: leaderIds.filter(Boolean) } })
      .select("name designation")
      .sort({ name: 1 });

    return {
      scope: "client_leader",
      rooms: [
        {
          id: req.client._id,
          name: leaders.length === 1 ? leaders[0].name : "Project leads",
          subtitle: leaders.map((l) => l.name).join(", ") || "No lead assigned yet",
        },
      ],
    };
  }

  if (tab === "employees") {
    if (!flags.employeeChatEnabled) return { disabled: true };

    return {
      scope: "client_employee",
      rooms: [
        {
          id: req.client._id,
          name: "Project team",
          subtitle: "Everyone working on your projects",
        },
      ],
    };
  }

  return null;
};

// GET /api/client/chat/rooms/:tab
export const getRooms = async (req, res) => {
  try {
    const resolved = await resolveRooms(req, req.params.tab);
    if (!resolved) return res.status(400).json({ message: "Unknown chat tab" });
    if (resolved.disabled) {
      return res.status(403).json({ message: "This conversation is turned off by the admin" });
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

    const lastByRoom = lastMessages.reduce((acc, row) => ({ ...acc, [String(row._id)]: row }), {});

    const rooms = resolved.rooms.map((room) => {
      const last = lastByRoom[String(room.id)];
      return {
        ...room,
        lastMessage: last?.text || "",
        lastMessageAt: last?.createdAt || null,
        lastSender: last?.senderName || "",
      };
    });

    return res.status(200).json({ tab: req.params.tab, scope: resolved.scope, rooms });
  } catch (err) {
    console.error("client getRooms error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

const authoriseRoom = async (req) => {
  const resolved = await resolveRooms(req, req.params.tab);
  if (!resolved) return { error: [400, "Unknown chat tab"] };
  if (resolved.disabled)
    return { error: [403, "This conversation is turned off by the admin"] };

  if (!mongoose.isValidObjectId(req.params.roomId)) {
    return { error: [400, "Invalid conversation"] };
  }
  // A client only ever has one room per tab: their own.
  if (String(req.params.roomId) !== String(req.client._id)) {
    return { error: [403, "That conversation is not yours"] };
  }

  return { scope: resolved.scope };
};

// GET /api/client/chat/:tab/:roomId
export const getMessages = async (req, res) => {
  try {
    const { scope, error } = await authoriseRoom(req);
    if (error) return res.status(error[0]).json({ message: error[1] });

    const messages = await Message.find({ scope, roomId: req.params.roomId })
      .sort({ createdAt: 1 })
      .limit(200);

    return res.status(200).json({ messages });
  } catch (err) {
    console.error("client getMessages error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/client/chat/:tab/:roomId  { text }
export const sendMessage = async (req, res) => {
  try {
    const { scope, error } = await authoriseRoom(req);
    if (error) return res.status(error[0]).json({ message: error[1] });

    const text = (req.body.text || "").trim();
    if (!text) return res.status(400).json({ message: "Message cannot be empty" });

    const message = await Message.create({
      scope,
      roomId: req.params.roomId,
      // `sender` refs User, so a client's message carries only their name
      senderName: req.client.name,
      text,
      readByAdmin: false,
    });

    emitMessage(scope, req.params.roomId, message);

    // Route the ping to whoever owns that thread on the company side
    const { projectIds } = await getScope(req);

    if (req.params.tab === "admin") {
      const admins = await User.find({ role: { $in: ADMIN_ROLES } }).distinct("_id");
      notifyUsers(admins, {
        type: "chat",
        title: `Message from ${req.client.name}`,
        message: text.slice(0, 120),
        link: "/admin/chat/clients",
      });
    } else if (req.params.tab === "team_leader") {
      const leaderIds = await Project.find({ _id: { $in: projectIds } }).distinct("teamLeader");
      notifyUsers(leaderIds, {
        type: "chat",
        title: `Message from ${req.client.name}`,
        message: text.slice(0, 120),
        link: "/team-leader/chat/clients",
      });
    } else if (req.params.tab === "employees") {
      const memberIds = await Project.find({ _id: { $in: projectIds } }).distinct("members");
      notifyUsers(memberIds, {
        type: "chat",
        title: `Message from ${req.client.name}`,
        message: text.slice(0, 120),
        link: "/employee/chat/clients",
      });
    }

    return res.status(201).json({ message: "Sent", data: message });
  } catch (err) {
    console.error("client sendMessage error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
