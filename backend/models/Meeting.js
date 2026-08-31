import mongoose from "mongoose";

export const MEETING_STATUS = ["requested", "scheduled", "completed", "cancelled"];
export const MEETING_MODES = ["online", "office", "site"];

const meetingSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, "Title is required"], trim: true },
    agenda: { type: String, trim: true, default: "" },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    // Whoever from the company is running it
    organizer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    scheduledAt: { type: Date, required: true },
    durationMinutes: { type: Number, min: 15, max: 480, default: 30 },
    mode: { type: String, enum: MEETING_MODES, default: "online" },
    // Meeting link for online, address for office/site
    location: { type: String, trim: true, default: "" },
    status: { type: String, enum: MEETING_STATUS, default: "requested" },
    // Set by the company once the meeting is done
    notes: { type: String, trim: true, default: "" },
    requestedByClient: { type: Boolean, default: false },
  },
  { timestamps: true }
);

meetingSchema.index({ client: 1, scheduledAt: -1 });

const Meeting = mongoose.model("Meeting", meetingSchema);

export default Meeting;
