import mongoose from "mongoose";

export const NOTIFICATION_TYPES = [
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
