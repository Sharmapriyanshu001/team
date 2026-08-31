import mongoose from "mongoose";

/**
 * Where a submission stands.
 *
 * "changes_required" is the team leader sending work back with a comment; it
 * is a distinct state from "rejected", which stays what it always was — the
 * admin's own refusal. Two different people, two different decisions, and a
 * screen that says "changes required" when the leader asked for changes.
 *
 * Added rather than substituted: every existing query names the status it
 * wants, so nothing that already worked reads differently.
 */
export const CODE_STATUSES = ["pending", "approved", "changes_required", "rejected"];

// Every access worth keeping in the trail. "viewed"/"downloaded" come from the
// people the code was shared with; the rest are review and admin actions.
export const ACCESS_ACTIONS = [
  "submitted",
  "version_added",
  "viewed",
  "downloaded",
  "approved",
  "changes_requested",
  "rejected",
  "shared",
  "revoked",
];

/**
 * One revision of the submission. The employee never edits a version in place —
 * a change is a new entry, so the history stays intact.
 */
const versionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    code: { type: String, default: "" },
    // Optional pointer at a repository/branch when the code lives elsewhere,
    // mirroring how FileDoc stores a link instead of the bytes.
    repoUrl: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

/**
 * One person the admin handed this code to. Nobody sees a submission unless
 * they are the author, an admin, or hold a row in here — a team leader gets
 * nothing automatically.
 */
const shareSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    canDownload: { type: Boolean, default: true },
    note: { type: String, trim: true, default: "" },
    sharedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

const accessSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Denormalised so the trail still reads correctly if an account is removed
    userName: { type: String, trim: true, default: "" },
    action: { type: String, enum: ACCESS_ACTIONS, required: true },
    detail: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

const codeSubmissionSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, "Title is required"], trim: true },
    description: { type: String, trim: true, default: "" },
    language: { type: String, trim: true, default: "other" },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },

    /**
     * The task this work was done for, when there is one.
     *
     * Optional, because plenty of code is submitted that is not a task — but
     * when it is set, approving the submission is what closes the task. That is
     * the join between the two review flows this app already had: a task moving
     * to "review" and a code submission waiting for the same person.
     */
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task" },

    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    /**
     * The team leader this submission is waiting on.
     *
     * Worked out when the code is submitted — the project's team leader, or
     * failing that whoever the employee reports to — and stored rather than
     * derived on every read, so "whose queue is this in" is a fact about the
     * submission instead of a join that can quietly answer differently later.
     *
     * Empty means nobody was found to review it, and it falls to the admin.
     * A submission is never allowed to land nowhere.
     */
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Status of the newest version
    status: { type: String, enum: CODE_STATUSES, default: "pending" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Which chair they were sitting in — a leader's review and an admin's read
    // differently, and roles change
    reviewedByRole: { type: String, trim: true, default: "" },
    reviewedAt: { type: Date },
    reviewNote: { type: String, trim: true, default: "" },

    /**
     * Highest version the admin signed off. Everything at or below it is what
     * shared users may read — a newer version pending review never leaks, and
     * rejecting it does not pull back code that was already approved.
     */
    approvedVersion: { type: Number, default: 0 },

    versions: [versionSchema],
    sharedWith: [shareSchema],
    accessLog: [accessSchema],
  },
  { timestamps: true }
);

codeSubmissionSchema.index({ submittedBy: 1, createdAt: -1 });
codeSubmissionSchema.index({ "sharedWith.user": 1, createdAt: -1 });
codeSubmissionSchema.index({ status: 1, createdAt: -1 });
// The team leader's review queue, which every page load of theirs asks for
codeSubmissionSchema.index({ reviewer: 1, status: 1, createdAt: -1 });

const CodeSubmission = mongoose.model("CodeSubmission", codeSubmissionSchema);

export default CodeSubmission;
