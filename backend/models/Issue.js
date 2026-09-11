import mongoose from "mongoose";

const issueSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, "Title is required"], trim: true },
    description: { type: String, trim: true, default: "" },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed"],
      default: "open",
    },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

/**
 * When an issue stopped being a problem.
 *
 * Stamped here rather than by whoever is saving, because three panels close
 * issues and each had its own copy of this — the admin form stamped it in the
 * browser, the two workspace controllers stamped it on the way in, and none of
 * them cleared it. A reopened issue kept the date it was resolved, which makes
 * "how long did this take" read as a negative number and "what is still open"
 * disagree with itself depending on which field you trust.
 */
issueSchema.pre("save", function () {
  if (!this.isModified("status")) return;

  const done = ["resolved", "closed"].includes(this.status);

  if (done && !this.resolvedAt) this.resolvedAt = new Date();
  // Back in play: the date it was fixed is no longer true
  if (!done) this.resolvedAt = undefined;
});

const Issue = mongoose.model("Issue", issueSchema);

export default Issue;
