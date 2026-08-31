import mongoose from "mongoose";

// One entry per employee per day: what they worked on and for how long.
// Powers the "Daily Work" and "Work History" screens in the employee panel.
const workLogSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: { type: Date, required: true },
    hours: { type: Number, min: 0, max: 24, default: 0 },
    summary: { type: String, trim: true, default: "" },
    blockers: { type: String, trim: true, default: "" },
    // Tasks the employee ticked off against this day
    tasks: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
  },
  { timestamps: true }
);

workLogSchema.index({ employee: 1, date: 1 }, { unique: true });

const WorkLog = mongoose.model("WorkLog", workLogSchema);

export default WorkLog;
