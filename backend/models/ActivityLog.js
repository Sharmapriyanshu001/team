import mongoose from "mongoose";

const activityLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorName: { type: String, trim: true, default: "System" },
    action: { type: String, trim: true, required: true }, // created | updated | deleted | login
    entity: { type: String, trim: true, default: "" }, // Client | Project | Task ...
    entityId: { type: mongoose.Schema.Types.ObjectId },
    message: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

activityLogSchema.index({ createdAt: -1 });

const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);

export default ActivityLog;
