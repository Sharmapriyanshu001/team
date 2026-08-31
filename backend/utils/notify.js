import Notification from "../models/Notification.js";

// Fire-and-forget: a notification failure must never break the request.
const create = (userId, userModel, { type, title, message = "", link = "" }) => {
  if (!userId) return;

  Notification.create({ user: userId, userModel, type, title, message, link }).catch((err) =>
    console.error("notify error:", err.message)
  );
};

/** Notify a staff member (admin, team leader or employee). */
export const notifyUser = (userId, payload) => create(userId, "User", payload);

export const notifyUsers = (userIds = [], payload) =>
  userIds.filter(Boolean).forEach((id) => notifyUser(id, payload));

/** Notify a client in their own portal. */
export const notifyClient = (clientId, payload) => create(clientId, "Client", payload);
