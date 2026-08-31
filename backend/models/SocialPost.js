import mongoose from "mongoose";

/**
 * One piece of content, from idea to posted.
 *
 * The status ladder is the calendar. Social work for a client is almost
 * entirely the business of getting something written, approved by them, and
 * out on the right day — so approval is a state here rather than a comment
 * thread somewhere else, and the day it is due is a first-class field.
 */

export const POST_STATUS = [
  "idea",
  "drafted",
  "awaiting_approval",
  "approved",
  "scheduled",
  "published",
  "cancelled",
];

const socialPostSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    seoProject: { type: mongoose.Schema.Types.ObjectId, ref: "SeoProject" },

    /**
     * The same post usually goes to several profiles at once, so this is a
     * list rather than one account. One row per platform would mean four rows
     * to approve for one piece of writing.
     */
    accounts: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialAccount" }],

    title: { type: String, trim: true, default: "" },
    caption: { type: String, trim: true, default: "" },
    hashtags: { type: [String], default: [] },

    /** What the creative is, in words. The file itself lives in Files. */
    mediaNote: { type: String, trim: true, default: "" },

    status: { type: String, enum: POST_STATUS, default: "idea" },

    scheduledFor: { type: Date },
    publishedAt: { type: Date },
    liveUrl: { type: String, trim: true, default: "" },

    /**
     * Who signed it off. A client approving in a chat thread is how a post
     * goes out that nobody agreed to, so it is recorded where the post is.
     */
    approvedAt: { type: Date },
    approvedByName: { type: String, trim: true, default: "" },
    clientFeedback: { type: String, trim: true, default: "" },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// The calendar reads by date; the queue reads by status
socialPostSchema.index({ client: 1, scheduledFor: 1 });
socialPostSchema.index({ status: 1, scheduledFor: 1 });
socialPostSchema.index({ seoProject: 1, scheduledFor: -1 });

const SocialPost = mongoose.model("SocialPost", socialPostSchema);

export default SocialPost;
