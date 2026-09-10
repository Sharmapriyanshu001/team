import mongoose from "mongoose";

// Where a file sits in the hand-over cycle. A plain document nobody has to act
// on stays "available"; the rest only apply once it is assigned to someone.
export const FILE_STATUSES = ["available", "assigned", "downloaded", "completed"];

// Covers both "Clients > Documents" and the global "Files" section.
const fileDocSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, "Title is required"], trim: true },
    // A link to storage elsewhere. Uploaded files leave this blank and are
    // served from `storedName` instead.
    url: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    category: {
      type: String,
      enum: ["contract", "invoice", "design", "report", "other"],
      default: "other",
    },
    fileType: { type: String, trim: true, default: "" },
    size: { type: Number, default: 0 },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    /* ------------------------------------------------- uploaded file only */

    // Name on disk. Never the name the user typed, so one upload cannot
    // overwrite another or escape the uploads folder.
    storedName: { type: String, trim: true, default: "" },
    originalName: { type: String, trim: true, default: "" },
    mimeType: { type: String, trim: true, default: "" },

    /* ---------------------------------------------------------- assignment */

    // The one person responsible for this file. Left empty for documents that
    // are simply filed against a project.
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedRole: { type: String, enum: ["operations_manager", "employee"] },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedAt: { type: Date },
    assignmentNote: { type: String, trim: true, default: "" },

    status: { type: String, enum: FILE_STATUSES, default: "available" },
    downloadedAt: { type: Date },
    completedAt: { type: Date },
    completionNote: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

fileDocSchema.index({ assignedTo: 1, status: 1, createdAt: -1 });

const FileDoc = mongoose.model("FileDoc", fileDocSchema);

export default FileDoc;
