import mongoose from "mongoose";

/**
 * What was actually said, and when — the communication history behind a deal.
 *
 * Lead.notes already held free text, and it stays: a quick line typed while
 * on the phone should not demand a form. But a note cannot answer "how many
 * times did we call before they answered", "who ran the demo", or "what
 * happened at the site visit", because it has no type, no outcome and no
 * duration. Those are the questions a sales review asks, so calls, meetings
 * and emails get a record with shape rather than a paragraph.
 *
 * Deliberately append-only in spirit: an activity is a thing that happened,
 * so the panel offers no edit for one older than the day it was logged. That
 * is a rule the routes enforce, not the schema — a correction on the same day
 * is ordinary, and refusing it would just push people to log nothing.
 */

export const ACTIVITY_TYPES = [
  "call",
  "meeting",
  "email",
  "whatsapp",
  "site_visit",
  "demo",
  "note",
];

/** Who started it. Useful on its own: inbound interest converts differently. */
export const ACTIVITY_DIRECTIONS = ["outbound", "inbound"];

export const ACTIVITY_OUTCOMES = [
  "connected",
  "no_answer",
  "busy",
  "rescheduled",
  "completed",
  "cancelled",
];

const salesActivitySchema = new mongoose.Schema(
  {
    /** One of these two, the same rule FollowUp follows. */
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead" },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },

    type: { type: String, enum: ACTIVITY_TYPES, default: "call" },
    direction: { type: String, enum: ACTIVITY_DIRECTIONS, default: "outbound" },

    subject: { type: String, trim: true, default: "" },
    summary: { type: String, trim: true, default: "" },

    outcome: { type: String, enum: ACTIVITY_OUTCOMES, default: "connected" },

    /** When it happened, which is not always when it was written down. */
    occurredAt: { type: Date, default: Date.now },
    durationMinutes: { type: Number, default: 0, min: 0 },

    /** Who else was in the room or on the call, as typed. */
    participants: { type: [String], default: [] },

    /**
     * The meeting this came from, when it was scheduled through the existing
     * Meetings screen rather than logged after the fact.
     */
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: "Meeting" },

    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Copied in so the history still reads after an account is renamed or gone
    byName: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

// One deal's timeline, and one person's activity for a performance review
salesActivitySchema.index({ lead: 1, occurredAt: -1 });
salesActivitySchema.index({ client: 1, occurredAt: -1 });
salesActivitySchema.index({ by: 1, occurredAt: -1 });

const SalesActivity = mongoose.model("SalesActivity", salesActivitySchema);

export default SalesActivity;
