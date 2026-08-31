import mongoose from "mongoose";

export const PROJECT_STATUS = [
  "planning",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
];

/**
 * Who put each of them there, and when.
 *
 * Runs beside `members` rather than replacing it: every query in the app
 * reads the id list, and none of them should have to change to learn who did
 * the adding. A person with no record here is simply somebody who was added
 * before this was tracked, or by an admin from their own screen.
 */
const assignmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Copied in so the record still reads after an account is renamed or gone
    assignedByName: { type: String, trim: true, default: "" },
    assignedByRole: { type: String, trim: true, default: "" },
    assignedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);
const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Name is required"], trim: true },
    code: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    teamLeader: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // One row per member, saying which team leader put them on it and when
    memberAssignments: { type: [assignmentSchema], default: [] },
    status: { type: String, enum: PROJECT_STATUS, default: "planning" },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    budget: { type: Number, default: 0 },
    startDate: { type: Date },
    endDate: { type: Date },
  },
  { timestamps: true }
);

const Project = mongoose.model("Project", projectSchema);

export default Project;
