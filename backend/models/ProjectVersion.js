import mongoose from "mongoose";

/**
 * One saved state of a code project's files.
 *
 * A version is a ZIP of the whole workspace, stored the same way the original
 * upload is. Keeping full snapshots rather than deltas is the deliberate
 * choice: restoring is then the same operation as extracting an upload — a
 * path this app already hardens and tests — instead of a replay engine whose
 * bugs would surface as quietly corrupted files.
 *
 * Version 1 is always the original upload, and points at the very archive the
 * admin sent. It is never deleted and never overwritten, so however far the
 * working copy drifts there is always a floor to come back to.
 */

const projectVersionSchema = new mongoose.Schema(
  {
    codeProject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CodeProject",
      required: true,
    },

    version: { type: Number, required: true },
    label: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },

    // The snapshot archive on disk. For version 1 this is the same stored name
    // as CodeProject.zipStoredName — which is why isOriginal exists.
    storedName: { type: String, required: true, trim: true },

    /**
     * True only for the untouched upload. Guards two things: this row can
     * never be deleted, and deleting it must never take the archive that
     * CodeProject still points at.
     */
    isOriginal: { type: Boolean, default: false },

    size: { type: Number, default: 0 },
    fileCount: { type: Number, default: 0 },

    // Files saved since the previous version — what this snapshot is "about"
    changedFiles: { type: [String], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Denormalised so the history still reads correctly if an account is gone
    createdByName: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

// One row per version number per project, and the history reads newest first
projectVersionSchema.index({ codeProject: 1, version: -1 }, { unique: true });

const ProjectVersion = mongoose.model("ProjectVersion", projectVersionSchema);

export default ProjectVersion;
