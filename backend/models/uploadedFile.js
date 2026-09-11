import mongoose from "mongoose";

/**
 * One uploaded paper. The bytes live under uploads/ and are never served
 * statically — `storedName` is only meaningful to a route that has already
 * decided the caller may see it.
 *
 * Shared rather than declared per model: a staff member's Aadhaar and a
 * candidate's CV are the same kind of thing stored the same way, and the
 * helpers in utils/staffDocuments.js read every one of them through the same
 * five fields. Two copies of this would drift the week one of them gained a
 * sixth.
 */
export const uploadedFileSchema = new mongoose.Schema(
  {
    storedName: { type: String, trim: true, required: true },
    originalName: { type: String, trim: true, default: "" },
    mimeType: { type: String, trim: true, default: "" },
    size: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

export default uploadedFileSchema;
