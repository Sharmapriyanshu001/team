import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import User from "../models/User.js";
import Client from "../models/Client.js";
import Project from "../models/Project.js";
import Setting from "../models/Setting.js";
import { allowedOrigins } from "../middleware/security.js";

/**
 * Live chat over Socket.IO.
 *
 * Every conversation in the app is already identified by (scope + roomId) — see
 * models/Message.js — so a socket room is simply "<scope>:<roomId>". The HTTP
 * send endpoints stay the source of truth: they validate, save, notify, and
 * then call `emitMessage` so whoever is watching that thread sees it at once.
 *
 * Joining a room is authorised here with the same rules the REST controllers
 * use, so a socket can never subscribe to a thread its owner cannot open.
 */
let io = null;

const roomKey = (scope, roomId) => `${scope}:${roomId}`;

const chatFlags = async () => {
  const settings = await Setting.findOne({ key: "general" });
  return {
    leaderClientChat: Boolean(settings?.leaderClientChat),
    employeeClientChat: Boolean(settings?.employeeClientChat),
  };
};

/* ------------------------------------------------------------ handshake */

/**
 * Resolve who is on the other end of a socket. Panels sign their tokens with
 * the same secret, so the account behind the id decides the identity — and a
 * client token is the one that carries no staff record.
 */
const identify = async (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  const user = await User.findById(decoded.id).select("name role status reportsTo tokenVersion");
  if (user) {
    if (user.status !== "active") throw new Error("Account is inactive");
    // Same check the REST middleware makes: a socket must not outlive the
    // session whose token opened it.
    if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) throw new Error("Session has ended");
    return { kind: user.role, id: String(user._id), name: user.name };
  }

  const client = await Client.findById(decoded.id).select("name status portalAccess tokenVersion");
  if (client) {
    if (!client.portalAccess || client.status === "inactive") {
      throw new Error("Portal access is turned off");
    }
    if ((decoded.tv ?? 0) !== (client.tokenVersion ?? 0)) throw new Error("Session has ended");
    return { kind: "client", id: String(client._id), name: client.name };
  }

  throw new Error("Unknown account");
};

/* -------------------------------------------------------- authorisation */

const sameId = (a, b) => String(a) === String(b);

// Clients this leader or employee shares a project with.
const clientIdsFor = async (projectQuery) => {
  const projectIds = await Project.find(projectQuery).distinct("_id");
  const clientIds = await Project.find({ _id: { $in: projectIds } }).distinct("client");
  return clientIds.filter(Boolean).map(String);
};

/**
 * Mirrors resolveRooms() in the four chat controllers: which (scope, roomId)
 * pairs this identity is allowed to watch.
 */
const canJoin = async (who, scope, roomId) => {
  if (!mongoose.isValidObjectId(roomId)) return false;

  if (who.kind === "admin") {
    // The admin owns every thread in the app
    return ["client", "team_leader", "employee_admin", "project"].includes(scope);
  }

  const flags = await chatFlags();

  if (who.kind === "team_leader") {
    if (scope === "team_leader") return sameId(roomId, who.id);
    if (scope === "employee") {
      const team = await User.find({ reportsTo: who.id }).distinct("_id");
      return team.map(String).includes(String(roomId));
    }
    if (scope === "client_leader") {
      if (!flags.leaderClientChat) return false;
      return (await clientIdsFor({ teamLeader: who.id })).includes(String(roomId));
    }
    return false;
  }

  if (who.kind === "employee") {
    // Both of the employee's own threads are keyed on their own id
    if (scope === "employee" || scope === "employee_admin") return sameId(roomId, who.id);
    if (scope === "client_employee") {
      if (!flags.employeeClientChat) return false;
      return (await clientIdsFor({ members: who.id })).includes(String(roomId));
    }
    return false;
  }

  if (who.kind === "client") {
    // A client only ever has their own room, one per scope
    if (!sameId(roomId, who.id)) return false;
    if (scope === "client") return true;
    if (scope === "client_leader") return flags.leaderClientChat;
    if (scope === "client_employee") return flags.employeeClientChat;
    return false;
  }

  return false;
};

/* ----------------------------------------------------------------- setup */

export const initRealtime = (httpServer) => {
  /**
   * The same origin list the REST API uses. `origin: true` reflected whatever
   * asked, which meant a page on any site could open a socket with a token it
   * had got hold of and sit in the chat rooms that token can reach — the one
   * thing a socket does that a stolen token cannot otherwise do quietly.
   */
  io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No token"));

      socket.data.who = await identify(token);
      return next();
    } catch (err) {
      return next(new Error(err.message || "Not authorised"));
    }
  });

  io.on("connection", (socket) => {
    const who = socket.data.who;

    // Personal channel — permission changes and future per-user pushes
    socket.join(`user:${who.id}`);

    socket.on("chat:join", async ({ scope, roomId } = {}, ack) => {
      try {
        if (!(await canJoin(who, scope, roomId))) {
          return ack?.({ ok: false, message: "That conversation is not yours" });
        }
        await socket.join(roomKey(scope, roomId));
        return ack?.({ ok: true });
      } catch (err) {
        console.error("chat:join error:", err.message);
        return ack?.({ ok: false, message: "Could not open that conversation" });
      }
    });

    socket.on("chat:leave", ({ scope, roomId } = {}) => {
      if (scope && roomId) socket.leave(roomKey(scope, roomId));
    });
  });

  console.log("✅ Realtime chat ready");
  return io;
};

/* --------------------------------------------------------------- emitters */

/** Push a freshly saved message to everyone watching that thread. */
export const emitMessage = (scope, roomId, message) => {
  if (!io) return;
  io.to(roomKey(scope, roomId)).emit("chat:message", {
    scope,
    roomId: String(roomId),
    message,
  });
};

/**
 * The admin flipped a chat permission. Everyone re-reads their tabs so a
 * conversation that was just switched off disappears without a refresh.
 */
export const emitChatPermissions = (flags) => {
  if (!io) return;
  io.emit("chat:permissions", flags);
};
