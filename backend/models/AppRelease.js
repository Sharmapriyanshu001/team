import mongoose from "mongoose";

/**
 * One upload to one track.
 *
 * Kept as its own record rather than a version field on the app, because the
 * question people actually ask is historical: what went out last Tuesday, why
 * was the build before it rejected, how long production has been sitting at
 * 20% rollout. An app that only remembers its current version can answer none
 * of those, and the rejection reasons are exactly what stops the same mistake
 * being made twice.
 */

export const RELEASE_TRACKS = ["internal", "closed", "open", "production"];

export const RELEASE_STATUS = [
  "draft",
  "submitted",
  "in_review",
  "live",
  "rejected",
  "halted",
];

const appReleaseSchema = new mongoose.Schema(
  {
    app: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PublishedApp",
      required: true,
    },

    versionName: { type: String, required: [true, "Version name is required"], trim: true },

    /**
     * Play's rule, not ours: a version code must be higher than every code
     * already uploaded to the app, forever. Enforced in the controller, which
     * can say which code it clashed with — a unique index here could only say
     * that something clashed.
     */
    versionCode: { type: Number, required: [true, "Version code is required"], min: 1 },

    track: { type: String, enum: RELEASE_TRACKS, default: "production" },

    /**
     * A staged rollout, as a percentage. 100 means everybody, which is also
     * what a release that was never staged looks like — and that is the right
     * answer for both, since "everyone has it" is the same fact either way.
     */
    rolloutPercent: { type: Number, min: 0, max: 100, default: 100 },

    status: { type: String, enum: RELEASE_STATUS, default: "draft" },

    releaseNotes: { type: String, trim: true, default: "" },

    submittedAt: { type: Date },
    liveAt: { type: Date },
    rejectedAt: { type: Date },

    /**
     * Why Google turned it down, in their words where possible.
     *
     * The single most useful field in this model. A rejection is usually one
     * of a handful of recurring policy problems, and having the last five
     * written down is what turns the sixth into a ten-minute fix.
     */
    rejectionReason: { type: String, trim: true, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Denormalised so the history still reads after an account is gone
    createdByName: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

// The history reads newest first, per app
appReleaseSchema.index({ app: 1, versionCode: -1 });
appReleaseSchema.index({ app: 1, createdAt: -1 });
appReleaseSchema.index({ status: 1 });

const AppRelease = mongoose.model("AppRelease", appReleaseSchema);

export default AppRelease;
