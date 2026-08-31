import mongoose from "mongoose";

/**
 * One link somebody else points at this client.
 *
 * Its own collection, unlike audit issues, because a backlink outlives
 * whatever produced it and has to be checked again later: links go dead
 * quietly, and a link that was paid for and has since vanished is the single
 * most common thing an SEO retainer is quietly wrong about.
 */

export const BACKLINK_TYPES = [
  "guest_post",
  "directory",
  "profile",
  "forum",
  "press",
  "editorial",
  "other",
];

export const BACKLINK_STATUS = ["pending", "live", "lost", "rejected", "nofollow"];

const backlinkSchema = new mongoose.Schema(
  {
    seoProject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SeoProject",
      required: true,
    },

    // Where the link lives
    sourceUrl: { type: String, required: [true, "The page carrying the link is required"], trim: true },
    sourceDomain: { type: String, trim: true, default: "", lowercase: true },

    // Where it points
    targetUrl: { type: String, trim: true, default: "" },
    anchorText: { type: String, trim: true, default: "" },

    type: { type: String, enum: BACKLINK_TYPES, default: "other" },
    status: { type: String, enum: BACKLINK_STATUS, default: "pending" },

    /** Whatever authority number the team works to. 0 means nobody checked. */
    authority: { type: Number, min: 0, max: 100, default: 0 },

    cost: { type: Number, min: 0, default: 0 },

    acquiredOn: { type: Date },
    /** When somebody last confirmed it was still there. */
    lastCheckedAt: { type: Date },
    lostAt: { type: Date },

    notes: { type: String, trim: true, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

backlinkSchema.index({ seoProject: 1, status: 1 });
backlinkSchema.index({ seoProject: 1, lastCheckedAt: 1 });

const Backlink = mongoose.model("Backlink", backlinkSchema);

export default Backlink;
