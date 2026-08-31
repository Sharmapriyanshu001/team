import mongoose from "mongoose";

/**
 * A project whose source lives in the app: an uploaded ZIP, extracted into a
 * per-project workspace folder that assigned staff open in the browser.
 *
 * Deliberately its own model rather than fields bolted onto Project. A Project
 * is the business record (client, budget, deadlines, tasks); this is the code.
 * One may point at the other through `project`, but neither needs the other to
 * exist — and nothing already querying Project changes shape.
 */

/**
 * Who put each of them there, and when.
 *
 * Runs beside `employees` rather than replacing it: every query in the app
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
export const CODE_PROJECT_STACKS = ["static", "node", "react", "vite", "next", "unknown"];

export const RUN_STATUSES = ["idle", "installing", "running", "stopped", "error"];

const codeProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Project name is required"], trim: true },
    description: { type: String, trim: true, default: "" },

    // Optional link to the business project this code belongs to
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },

    /* ------------------------------------------------------ the uploaded zip */

    // The original archive is never modified or extracted over. It is the
    // floor the version history stands on.
    zipStoredName: { type: String, trim: true, default: "" },
    zipOriginalName: { type: String, trim: true, default: "" },
    zipSize: { type: Number, default: 0 },

    /* -------------------------------------------------------- the workspace */

    // Folder name under uploads/workspaces — always this document's own id, so
    // two projects can never resolve to the same place.
    workspaceReady: { type: Boolean, default: false },
    fileCount: { type: Number, default: 0 },
    totalSize: { type: Number, default: 0 },

    // Entries the extractor refused or ignored, kept so the admin can see that
    // an archive was not extracted whole rather than guessing.
    extractReport: {
      skipped: { type: [{ name: String, reason: String }], default: [] },
      rejected: { type: [{ name: String, reason: String }], default: [] },
    },

    stack: { type: String, enum: CODE_PROJECT_STACKS, default: "unknown" },
    entryFile: { type: String, trim: true, default: "" },
    packageScripts: { type: Map, of: String, default: {} },

    // Where the project actually starts, when it is not the workspace root —
    // a repo with backend/ and frontend/ beside each other has no root
    // package.json, and whatever runs it later needs to know which folder.
    rootDir: { type: String, trim: true, default: "" },

    /* -------------------------------------------------------- who works on it */

    teamLeaders: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    employees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // Which team leader handed the workspace to each of them, and when
    employeeAssignments: { type: [assignmentSchema], default: [] },

    // What assigned staff may do. The admin is never restricted by these.
    permissions: {
      canEdit: { type: Boolean, default: true },
      canCreateDelete: { type: Boolean, default: false },
      canRun: { type: Boolean, default: true },
    },

    /* --------------------------------------------------------------- state */

    currentVersion: { type: Number, default: 1 },

    // Files saved since the last snapshot. Emptied when a version is taken, so
    // the history can say what each version was actually about.
    pendingChanges: { type: [String], default: [] },
    runStatus: { type: String, enum: RUN_STATUSES, default: "idle" },

    status: { type: String, enum: ["active", "archived"], default: "active" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    /* ------------------------------------------------------------- the bin */

    /**
     * Deleting a code project used to take the record, the workspace, every
     * snapshot and the original archive with it, the moment the button was
     * pressed. There was nothing to change your mind with.
     *
     * So a delete sets this instead. The project drops out of every list,
     * assigned staff lose access to it entirely, and any dev server it had
     * running is stopped — but the bytes are still on disk, and the admin can
     * put it back. Only a second, explicit act destroys anything.
     *
     * Empty means live. Every query that should not see the bin filters on
     * it, and accessFor() refuses non-admins outright, so nobody keeps working
     * in a workspace that has been deleted out from under them.
     *
     * This is also what lets an employee or a team leader delete a project at
     * all: their delete is this and only this, and the bin it lands in is a
     * screen they cannot open.
     */
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    /**
     * The role that account held at the moment they deleted it.
     *
     * Not a duplicate of deletedBy.role: the bin has to say who deleted a
     * project and in what capacity, and a person's role can change — or their
     * account can be removed — between the delete and the admin reading the
     * bin. Same reasoning as requestedByRole on ProjectRequest.
     */
    deletedByRole: { type: String, trim: true, default: "" },
    deleteReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

// The three questions every list screen asks
codeProjectSchema.index({ createdAt: -1 });
codeProjectSchema.index({ deletedAt: 1, createdAt: -1 });
codeProjectSchema.index({ teamLeaders: 1, createdAt: -1 });
codeProjectSchema.index({ employees: 1, createdAt: -1 });

const CodeProject = mongoose.model("CodeProject", codeProjectSchema);

export default CodeProject;
