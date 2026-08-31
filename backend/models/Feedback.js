import mongoose from "mongoose";

export const FEEDBACK_CATEGORIES = [
  "quality",
  "communication",
  "timeliness",
  "budget",
  "overall",
];

const feedbackSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    category: { type: String, enum: FEEDBACK_CATEGORIES, default: "overall" },
    rating: { type: Number, min: 1, max: 5, required: true },
    message: { type: String, trim: true, default: "" },
    // Filled in when someone from the company replies
    response: { type: String, trim: true, default: "" },
    respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    respondedAt: { type: Date },
    status: {
      type: String,
      enum: ["open", "reviewed", "closed"],
      default: "open",
    },
  },
  { timestamps: true }
);

feedbackSchema.index({ client: 1, createdAt: -1 });

const Feedback = mongoose.model("Feedback", feedbackSchema);

export default Feedback;
