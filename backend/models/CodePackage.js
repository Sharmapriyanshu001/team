import mongoose from "mongoose";

/**
 * A ZIP one person sends straight to a group of colleagues.
 *
 * Deliberately separate from CodeSubmission: that one is the review pipeline
 * (paste code, versions, the admin approves and hands it out). This is the
 * plain hand-over — pick people, attach an archive, send. One record holds the
 * whole send, so "who did I give this to" is a single row rather than a set of
 * near-identical copies, and withdrawing it withdraws it from everybody.
 */

const recipientSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Denormalised so the sender's history still reads correctly after an
    // account is deleted — the same reason CodeSubmission keeps userName.
    name: { type: String, trim: true, default: "" },
    role: { type: String, trim: true, default: "" },

    downloadedAt: { type: Date },
    downloadCount: { type: Number, default: 0 },
  },
  { _id: false }
);

const codePackageSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, "Title is required"], trim: true },
    note: { type: String, trim: true, default: "" },

    /* ------------------------------------------------------------- the zip */

    // Random name on disk, never the name the sender typed
    storedName: { type: String, required: true, trim: true },
    originalName: { type: String, trim: true, default: "" },
    mimeType: { type: String, trim: true, default: "" },
    size: { type: Number, default: 0 },

    /* ---------------------------------------------------- who sent it, to whom */

    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sentByName: { type: String, trim: true, default: "" },
    sentByRole: { type: String, trim: true, default: "" },

    recipients: {
      type: [recipientSchema],
      validate: {
        validator: (list) => list.length > 0,
        message: "Pick at least one person to send this to",
      },
    },
  },
  { timestamps: true }
);

codePackageSchema.index({ sentBy: 1, createdAt: -1 });
codePackageSchema.index({ "recipients.user": 1, createdAt: -1 });

const CodePackage = mongoose.model("CodePackage", codePackageSchema);

export default CodePackage;
