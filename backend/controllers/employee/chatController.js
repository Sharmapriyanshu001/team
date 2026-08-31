import mongoose from "mongoose";
import Message from "../../models/Message.js";
import User, { ADMIN_ROLES } from "../../models/User.js";
import Client from "../../models/Client.js";
import Project from "../../models/Project.js";
import Setting from "../../models/Setting.js";
import { getScope } from "../../middleware/employeeAuth.js";
import { notifyUser, notifyClient } from "../../utils/notify.js";
import { emitMessage } from "../../utils/realtime.js";

/**
 * The employee's three tabs:
 *   team_leader -> scope "employee",       room = their own id
 *   admin       -> scope "employee_admin", room = their own id
 *   client      -> scope "client",         room = a client on their projects
 */
const clientChatEnabled = async () => {
  const settings = await Setting.findOne({ key: "general" });
  return Boolean(settings?.employeeClientChat);
};

const resolveRooms = async (req, tab) => {
  if (tab === "team_leader") {
    const { leaderId } = await getScope(req);
    if (!leaderId) return { scope: "employee", rooms: [] };

    const leader = await User.findById(leaderId).select("name email designation");
    return {
      scope: "employee",
      rooms: [
        {
          id: req.employee._id,
          name: leader?.name || "Team Leader",
          subtitle: leader?.designation || leader?.email || "",
        },
      ],
    };
  }

  if (tab === "admin") {
    const admin = await User.findOne({ role: { $in: ADMIN_ROLES } }).select("name email");
    return {
      scope: "employee_admin",
      rooms: [
        {
          id: req.employee._id,
          name: admin?.name || "Administrator",
          subtitle: admin?.email || "Admin team",
        },
      ],
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
      scope: "client_employee",
      rooms: clients.map((c) => ({
        id: c._id,
        name: c.name,
        subtitle: c.company || c.email,
      })),
    };
  }

  return null;
};

// GET /api/employee/chat/rooms/:tab
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

    rooms.sort((a, b) => {
      if (a.lastMessageAt && b.lastMessageAt)
        return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
      if (a.lastMessageAt) return -1;
      if (b.lastMessageAt) return 1;
      return a.name.localeCompare(b.name);
    });

    return res.status(200).json({ tab: req.params.tab, scope: resolved.scope, rooms });
  } catch (err) {
    console.error("employee getRooms error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

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

// GET /api/employee/chat/:tab/:roomId
export const getMessages = async (req, res) => {
  try {
    const { scope, error } = await authoriseRoom(req);
    if (error) return res.status(error[0]).json({ message: error[1] });

    const messages = await Message.find({ scope, roomId: req.params.roomId })
      .sort({ createdAt: 1 })
      .limit(200);

    return res.status(200).json({ messages });
  } catch (err) {
    console.error("employee getMessages error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/employee/chat/:tab/:roomId  { text }
export const sendMessage = async (req, res) => {
  try {
    const { scope, error } = await authoriseRoom(req);
    if (error) return res.status(error[0]).json({ message: error[1] });

    const text = (req.body.text || "").trim();
    if (!text) return res.status(400).json({ message: "Message cannot be empty" });

    const message = await Message.create({
      scope,
      roomId: req.params.roomId,
      sender: req.employee._id,
      senderName: req.employee.name,
      text,
      readByAdmin: false,
    });

    emitMessage(scope, req.params.roomId, message);

    // Ping whoever is on the other end of this thread
    if (req.params.tab === "team_leader") {
      const { leaderId } = await getScope(req);
      notifyUser(leaderId, {
        type: "chat",
        title: `Message from ${req.employee.name}`,
        message: text.slice(0, 120),
        link: "/team-leader/chat/employees",
      });
    } else if (req.params.tab === "admin") {
      const admins = await User.find({ role: { $in: ADMIN_ROLES } }).select("_id");
      admins.forEach((admin) =>
        notifyUser(admin._id, {
          type: "chat",
          title: `Message from ${req.employee.name}`,
          message: text.slice(0, 120),
          link: "/admin/chat/employees",
        })
      );
    } else if (req.params.tab === "client") {
      notifyClient(req.params.roomId, {
        type: "chat",
        title: `Message from ${req.employee.name}`,
        message: text.slice(0, 120),
        link: "/client/chat/employees",
      });
    }

    return res.status(201).json({ message: "Sent", data: message });
  } catch (err) {
    console.error("employee sendMessage error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
