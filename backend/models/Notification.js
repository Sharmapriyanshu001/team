import mongoose from "mongoose";

export const NOTIFICATION_TYPES = [
  /**
   * Anything that is simply news for one person rather than an event on a
   * project, a task or a review: a leave decision, a hiring update, an account
   * change.
   *
   * It was missing, and seven call sites across HR, hiring and the employee
   * panel were already sending it. A mongoose enum rejects on write, and
   * notify.js deliberately swallows failures so that a notification can never
   * break the request that caused it — so every one of those was thrown away
   * silently. Nobody had ever been told their leave was approved.
   */
  "general",
  "project",
  "task",
  "review",
  "issue",
  "chat",
  "system",
];

const notificationSchema = new mongoose.Schema(
  {
    // Recipients are staff (User) or clients (Client), so the ref is dynamic.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "userModel",
      required: true,
    },
    userModel: {
      type: String,
      enum: ["User", "Client"],
      default: "User",
    },
    type: { type: String, enum: NOTIFICATION_TYPES, default: "system" },
    title: { type: String, trim: true, required: true },
    message: { type: String, trim: true, default: "" },
    // In-app route the notification points at, e.g. "/leader/issues"
    link: { type: String, trim: true, default: "" },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
