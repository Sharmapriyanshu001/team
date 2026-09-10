import mongoose from "mongoose";

/**
 * A client asking for something to be changed on their own project.
 *
 * This is deliberately not a Task and not a chat message, and it is worth
 * saying why, because it looks like both.
 *
 * It is not a Task because a task is work the company decided to do. This is
 * work the client asked for, and the two need different answers to "who may
 * create one" — a client cannot be given the task board, and a change nobody
 * has agreed to yet is not something an employee should find sitting in their
 * queue as if a manager had put it there. When somebody does take it on, a
 * Task can be raised from it; the request stays as the record of what was
 * asked.
 *
 * It is not a chat message because a message scrolls away. The question a
 * client asks three weeks later is "what happened to the change I requested",
 * and the answer has to be a row with a status on it rather than an
 * archaeology exercise through a thread. models/Message.js already carries the
 * conversation — this carries the commitment.
 *
 * WHO CAN SEE ONE
 *
 * A request belongs to exactly one project, and every read of it is scoped by
 * that: the client sees requests on their own projects, the assignee sees the
 * ones handed to them, the project's leader sees their project's, and the
 * admin sees all of them. The scoping lives in the handlers rather than here,
 * but `project` is what every one of them filters on — so a request can never
 * be reachable by somebody who cannot reach the project.
 */

export const CHANGE_STATUSES = ["open", "in_progress", "completed", "rejected"];

export const CHANGE_PRIORITIES = ["low", "medium", "high"];

/**
 * One entry in the request's history.
 *
 * Both sides write here — the client adding a clarification and the employee
 * reporting progress are the same kind of event, and splitting them into two
 * collections would mean neither could be read as a conversation. `authorModel`
 * is what keeps a Client id and a User id apart, since the two collections
 * have their own id spaces and a populate against the wrong one silently
 * returns nothing.
 */
const updateSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, refPath: "updates.authorModel" },
    authorModel: { type: String, enum: ["User", "Client"], default: "User" },
    // Copied in, so the history still reads after an account is closed
    authorName: { type: String, trim: true, default: "" },
    authorRole: { type: String, trim: true, default: "" },

    note: { type: String, trim: true, default: "" },

    /**
     * The progress and status this entry moved the request to, or empty if it
     * did not move them. Recorded per entry rather than only on the request,
     * so "when did this go from 40% to 90%" is answerable — which is the
     * question asked when a deadline is missed.
     */
    progress: { type: Number, min: 0, max: 100 },
    status: { type: String, enum: CHANGE_STATUSES },

    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const changeRequestSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: [true, "A change request belongs to a project"],
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: [true, "A change request is raised by a client"],
    },

    title: { type: String, required: [true, "Say what needs changing"], trim: true },
    detail: { type: String, trim: true, default: "" },

    priority: { type: String, enum: CHANGE_PRIORITIES, default: "medium" },
    status: { type: String, enum: CHANGE_STATUSES, default: "open" },

    /**
     * The person carrying it. Empty until somebody takes it on, which is the
     * state that matters most on the admin's monitoring screen: an open
     * request with nobody against it is one the client is waiting on and
     * nobody has picked up.
     */
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedAt: { type: Date },

    /** Raised from this request, if somebody turned it into scheduled work. */
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task" },

    progress: { type: Number, min: 0, max: 100, default: 0 },

    updates: { type: [updateSchema], default: [] },

    completedAt: { type: Date },
    /** Why it was turned down. Required by the handler, not by the schema. */
    closingNote: { type: String, trim: true, default: "" },

    /**
     * The red dots, one per side.
     *
     * Two booleans rather than one "unread" flag, because the same row is
     * unread by different people at different times: a client's new request is
     * unseen by the team, and the team's reply is unseen by the client.
     */
    seenByTeam: { type: Boolean, default: false },
    seenByClient: { type: Boolean, default: true },
  },
  { timestamps: true }
);

/**
 * Finishing a request stamps the date and squares the progress off, for the
 * same reason Task.js does it: three panels can move this status, and a
 * completion date recorded by two of them is a report that quietly disagrees
 * with itself.
 */
changeRequestSchema.pre("save", function () {
  if (this.isModified("status")) {
    if (this.status === "completed") {
      this.completedAt = new Date();
      this.progress = 100;
    } else {
      this.completedAt = undefined;
    }
  }
});

/** "What is outstanding on this project?" — the client's screen and the admin's. */
changeRequestSchema.index({ project: 1, status: 1, createdAt: -1 });
/** "What has been handed to me?" — the employee's. */
changeRequestSchema.index({ assignedTo: 1, status: 1 });
/** The dots. */
changeRequestSchema.index({ client: 1, seenByClient: 1 });

const ChangeRequest = mongoose.model("ChangeRequest", changeRequestSchema);

export default ChangeRequest;
