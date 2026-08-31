import mongoose from "mongoose";

/**
 * One app on one console.
 *
 * The store listing lives here rather than in a table of its own. It is edited
 * as a single block of text by one person at a time, it is what the ASO work
 * actually changes, and splitting it out would mean a join on every screen
 * that shows an app for no gain at all.
 *
 * Version numbers here are a cache of the newest live release, kept so a list
 * of forty apps does not need forty release lookups to say what is out. The
 * releases themselves are the record; this is a read convenience, and
 * AppRelease is what updates it.
 */

export const APP_STATUS = [
  "draft",
  "in_review",
  "live",
  "rejected",
  "suspended",
  "unpublished",
];

const assignmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedByName: { type: String, trim: true, default: "" },
    assignedByRole: { type: String, trim: true, default: "" },
    assignedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

/**
 * What Play shows on the store page — and therefore what ASO work is.
 *
 * The three length caps are Google's, written down here because a listing that
 * is four characters too long is rejected after the upload rather than before
 * it, and finding that out from a rejection email is a wasted day.
 */
const listingSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, default: "", maxlength: 30 },
    shortDescription: { type: String, trim: true, default: "", maxlength: 80 },
    fullDescription: { type: String, trim: true, default: "", maxlength: 4000 },
    // What this listing is trying to rank for. Play has no keyword field, so
    // these are the terms the title and description are written around.
    keywords: { type: [String], default: [] },
    promoText: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const publishedAppSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "App name is required"], trim: true },

    /**
     * The package name, which is the one thing about an app that can never be
     * changed after the first upload. Unique across the studio because it is
     * unique across Play — two rows sharing one would mean one of them is
     * about an app somebody else owns.
     */
    packageName: {
      type: String,
      required: [true, "Package name is required"],
      trim: true,
      lowercase: true,
      unique: true,
    },

    console: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeveloperConsole",
      required: [true, "An app has to sit on a console"],
    },

    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    // Optional link to the business project this app was built under
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },

    status: { type: String, enum: APP_STATUS, default: "draft" },

    category: { type: String, trim: true, default: "" },
    contentRating: { type: String, trim: true, default: "" },

    listing: { type: listingSchema, default: () => ({}) },

    // Cache of the newest production release. Written by AppRelease, not by hand.
    liveVersionName: { type: String, trim: true, default: "" },
    liveVersionCode: { type: Number, default: 0 },
    lastReleaseAt: { type: Date },

    storeUrl: { type: String, trim: true, default: "" },

    firstPublishedAt: { type: Date },
    notes: { type: String, trim: true, default: "" },

    employees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    assignments: { type: [assignmentSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

publishedAppSchema.index({ console: 1, createdAt: -1 });
publishedAppSchema.index({ client: 1 });
publishedAppSchema.index({ status: 1, createdAt: -1 });
publishedAppSchema.index({ employees: 1 });

const PublishedApp = mongoose.model("PublishedApp", publishedAppSchema);

export default PublishedApp;
