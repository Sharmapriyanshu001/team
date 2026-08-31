import mongoose from "mongoose";

/**
 * One social profile the studio posts to on a client's behalf.
 *
 * The follower count is a single current number with a small history beside
 * it, for the same reason a keyword keeps its own series: growth is the whole
 * product of social work, and a number with no yesterday cannot show it.
 */

export const SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "linkedin",
  "x",
  "youtube",
  "pinterest",
  "threads",
  "other",
];

const followerPointSchema = new mongoose.Schema(
  { date: { type: Date, required: true }, followers: { type: Number, default: 0 } },
  { _id: false }
);

const socialAccountSchema = new mongoose.Schema(
  {
    seoProject: { type: mongoose.Schema.Types.ObjectId, ref: "SeoProject" },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: [true, "A social account belongs to a client"],
    },

    platform: { type: String, enum: SOCIAL_PLATFORMS, default: "instagram" },
    handle: { type: String, required: [true, "The handle is required"], trim: true },
    profileUrl: { type: String, trim: true, default: "" },

    followers: { type: Number, default: 0, min: 0 },
    followerHistory: { type: [followerPointSchema], default: [] },

    /**
     * The login is not here on purpose. Social credentials belong in the
     * vault, which encrypts them and records who opened them — the same rule
     * the Play consoles follow.
     */
    status: { type: String, enum: ["active", "paused", "closed"], default: "active" },

    notes: { type: String, trim: true, default: "" },

    employees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

socialAccountSchema.index({ client: 1, platform: 1 });
socialAccountSchema.index({ seoProject: 1 });

const SocialAccount = mongoose.model("SocialAccount", socialAccountSchema);

export default SocialAccount;
