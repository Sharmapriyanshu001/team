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
    operationsManager: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // One row per member, saying which operations manager put them on it and when
    memberAssignments: { type: [assignmentSchema], default: [] },
    /**
     * The job this one continues from.
     *
     * Copied from the client when a project is created, so that whoever opens
     * this project can see what was built before without going looking. It can
     * also be set or cleared per project, because the second job for a client
     * is not always a continuation of the first.
     *
     * Self-referential and deliberately not a chain — it points at what came
     * before, not at a list. Following it back is how the history is read.
     */
    previousProject: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },

    /**
     * "Have we built this before?", answered while the project is being
     * created, and the link to what was built.
     *
     * Beside `previousProject` rather than folded into it, because they answer
     * different questions. That one points at another row in this database —
     * the earlier job for the same client, picked from a list. This one is
     * whatever the person creating the project has in their hand: the live
     * site, the repository, a folder of the last build, a project on somebody
     * else's panel. A URL is the only thing those have in common, so a URL is
     * what is stored.
     *
     * Both can be set, and often should be. Neither is required.
     */
    existingWork: {
      /**
       * Deliberately three-valued: null is "nobody has been asked", false is
       * "asked, and no". A project created before this existed answers null
       * and is not quietly reported as fresh work.
       */
      builtBefore: { type: Boolean, default: null },
      link: { type: String, trim: true, default: "" },
      note: { type: String, trim: true, default: "" },
    },

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
