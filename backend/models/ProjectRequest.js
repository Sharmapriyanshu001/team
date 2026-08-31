import mongoose from "mongoose";

/**
 * A team leader or employee asking the admin to change or remove a code
 * project.
 *
 * The panels those two work in have no route that edits a project's details,
 * its assignment or its existence — and this does not add one. It records the
 * ask, and the admin's answer is what actually touches the project. So the
 * authority stays exactly where it was; what changes is that "I need this
 * project renamed" stops having to travel over chat.
 *
 * The project's name is copied in at creation. A request has to stay readable
 * after the project it refers to is permanently deleted, and a dangling
 * populate leaves a row that says nothing about what was asked for.
 */

export const REQUEST_TYPES = ["edit", "delete"];

export const REQUEST_STATUSES = ["pending", "approved", "rejected"];

const projectRequestSchema = new mongoose.Schema(
  {
    codeProject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CodeProject",
      required: true,
    },
    // Snapshot, not a lookup — see above
    projectName: { type: String, trim: true, default: "" },

    type: { type: String, enum: REQUEST_TYPES, required: true },

    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Kept beside the ref so the list reads correctly even if the account's
    // role changes later — the request was made by whoever they were then.
    requestedByRole: { type: String, trim: true, default: "" },

    reason: { type: String, trim: true, default: "" },

    /**
     * What an edit request wants changed. Deliberately only the two fields the
     * admin's own inline editor touches: assignment, per-project permissions
     * and ownership are not requestable, because approving one by reflex would
     * be how a leader quietly writes themselves onto a project.
     */
    changes: {
      name: { type: String, trim: true, default: "" },
      description: { type: String, trim: true, default: "" },
    },

    status: { type: String, enum: REQUEST_STATUSES, default: "pending" },

    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decidedAt: { type: Date },
    decisionNote: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

// The two questions asked of this collection: "what is waiting for me?" and
// "what has this project got outstanding?"
projectRequestSchema.index({ status: 1, createdAt: -1 });
projectRequestSchema.index({ codeProject: 1, status: 1 });
projectRequestSchema.index({ requestedBy: 1, createdAt: -1 });

const ProjectRequest = mongoose.model("ProjectRequest", projectRequestSchema);

export default ProjectRequest;
