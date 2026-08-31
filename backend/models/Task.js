import mongoose from "mongoose";

export const TASK_STATUS = ["pending", "in_progress", "review", "completed"];

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, "Title is required"], trim: true },
    description: { type: String, trim: true, default: "" },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: TASK_STATUS, default: "pending" },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    dueDate: { type: Date },
    completedAt: { type: Date },
    // False from the moment work lands on someone until they open their task
    // list — that is what puts the red dot on their sidebar. Existing tasks
    // default to true so nothing lights up retrospectively.
    seenByAssignee: { type: Boolean, default: true },
    // Filled in when a task is reviewed
    reviewNote: { type: String, trim: true, default: "" },
    reviewRating: { type: Number, min: 0, max: 5, default: 0 },
  },
  { timestamps: true }
);

// Keep completedAt in sync with the status so reports stay accurate.
// Declared with no arguments so Mongoose treats it as a promise-style hook —
// `next` is no longer passed to document middleware.
taskSchema.pre("save", function () {
  if (this.isModified("status")) {
    this.completedAt = this.status === "completed" ? new Date() : undefined;
  }
});

// Powers the "you have new work" dot, which every panel load asks for.
taskSchema.index({ assignedTo: 1, seenByAssignee: 1 });

const Task = mongoose.model("Task", taskSchema);

export default Task;
