import mongoose from "mongoose";

/**
 * Somebody who might become a client.
 *
 * Client.status already had a "lead" value, which was enough to mark one and
 * nothing else — no stage, no follow-up date, no record of what was said. A
 * lead that nobody has to call back on a particular day is a lead that goes
 * cold, so those two fields are the reason this model exists.
 *
 * Converting produces a real Client and keeps the lead as history rather than
 * deleting it: how long a deal took and where it came from is the only way to
 * learn which sources are worth anything.
 */

export const LEAD_STAGES = [
  "new",
  "contacted",
  "qualified",
  "quoted",
  "negotiating",
  "won",
  "lost",
];

export const LEAD_SOURCES = [
  "referral",
  "website",
  "social",
  "cold_outreach",
  "marketplace",
  "walk_in",
  "repeat_client",
  "other",
];

/** What was said, and when. Embedded — a note has no life without its lead. */
const noteSchema = new mongoose.Schema(
  {
    body: { type: String, trim: true, required: true },
    byName: { type: String, trim: true, default: "" },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Name is required"], trim: true },
    company: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },

    source: { type: String, enum: LEAD_SOURCES, default: "other" },
    /** Free text beside the source — which referral, which marketplace. */
    sourceDetail: { type: String, trim: true, default: "" },

    /** What they want, in the words they used. */
    requirement: { type: String, trim: true, default: "" },
    services: { type: [String], default: [] },

    stage: { type: String, enum: LEAD_STAGES, default: "new" },

    /** Rough value, so a pipeline can be worth something rather than counted. */
    estimatedValue: { type: Number, default: 0, min: 0 },

    /**
     * The single most important field here. A lead with no next date is one
     * that will be remembered by accident or not at all, so the list sorts by
     * it and the dashboard counts the ones that have gone by.
     */
    followUpOn: { type: Date },

    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    notes: { type: [noteSchema], default: [] },

    /* --------------------------------------------------------- the outcome */

    wonAt: { type: Date },
    lostAt: { type: Date },
    lostReason: { type: String, trim: true, default: "" },

    /** Set when this lead became a real client. */
    convertedClient: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// The pipeline board, and the "who do I call today" list
leadSchema.index({ stage: 1, followUpOn: 1 });
leadSchema.index({ owner: 1, followUpOn: 1 });
leadSchema.index({ createdAt: -1 });

const Lead = mongoose.model("Lead", leadSchema);

export default Lead;
