import Notification from "../models/Notification.js";
import { emitNotification } from "./realtime.js";

// Fire-and-forget: a notification failure must never break the request.
const create = (userId, userModel, { type, title, message = "", link = "" }) => {
  if (!userId) return;

  Notification.create({ user: userId, userModel, type, title, message, link })
    /**
     * Pushed live the moment it is saved, so an inbox that is already open
     * shows it without a refresh. Chained onto the write rather than sent
     * beside it, because a notification nobody managed to store is not one
     * anybody should be told about.
     */
    .then((saved) => emitNotification(userId, saved))
    .catch((err) => console.error("notify error:", err.message));
};

/** Notify a staff member (admin, operations manager or employee). */
export const notifyUser = (userId, payload) => create(userId, "User", payload);

export const notifyUsers = (userIds = [], payload) =>
  userIds.filter(Boolean).forEach((id) => notifyUser(id, payload));

/** Notify a client in their own portal. */
export const notifyClient = (clientId, payload) => create(clientId, "Client", payload);
