import { io } from "socket.io-client";

/**
 * One Socket.IO connection per panel, kept alive across page navigation.
 *
 * Each panel stores its own token under its own key (adminToken, leaderToken,
 * employeeToken, clientToken) so an admin and a client can be signed in side by
 * side — the socket follows the same rule and connects once per token key.
 */
const SOCKET_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace(
  /\/api\/?$/,
  ""
);

const sockets = new Map();

export const getSocket = (tokenKey) => {
  const token = localStorage.getItem(tokenKey);
  if (!token) return null;

  const existing = sockets.get(tokenKey);
  // A fresh sign-in issues a new token, so the old connection is stale
  if (existing && existing.auth?.token === token) return existing.socket;
  if (existing) existing.socket.disconnect();

  const socket = io(SOCKET_URL, {
    auth: { token },
    transports: ["websocket", "polling"],
  });

  sockets.set(tokenKey, { socket, auth: { token } });
  return socket;
};

/** Drop the panel's connection — call this on logout. */
export const closeSocket = (tokenKey) => {
  const existing = sockets.get(tokenKey);
  if (!existing) return;

  existing.socket.disconnect();
  sockets.delete(tokenKey);
};
