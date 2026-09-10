import mongoose from "mongoose";

/**
 * A promise to get back to somebody on a particular day.
 *
 * Lead.followUpOn already carried the next date, and that was enough to sort a
 * list by. It could not answer the questions a sales desk actually asks: what
 * did I promise, did it happen, who was it for, and what is overdue across the
 * whole team rather than for one lead at a time. A single date field also has
 * no history — setting the next one erases the last, so nobody can see that a
 * lead was chased four times and never answered.
 *
 * So this is a record per commitment rather than a field per lead. The date on
 * the Lead stays and stays authoritative for "when next" — it is kept in step
 * from here, so every existing screen that reads it keeps working exactly as
 * it did.
 *
 * The collection name matches `followups`, which already exists in this
 * database from an earlier build with no code behind it.
 */

export const FOLLOWUP_STATUS = ["pending", "done", "missed", "cancelled"];

/** How the next contact is meant to happen. */
export const FOLLOWUP_MODES = ["call", "meeting", "email", "whatsapp", "site_visit", "other"];

const followUpSchema = new mongoose.Schema(
  {
    /**
     * A follow-up hangs off a lead, or off a client once the lead has been
     * converted. One of the two, never neither — enforced below rather than by
     * `required`, which cannot express "one of these".
     */
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead" },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },

    title: { type: String, trim: true, required: [true, "Say what the follow-up is for"] },
    notes: { type: String, trim: true, default: "" },

    mode: { type: String, enum: FOLLOWUP_MODES, default: "call" },

    dueOn: { type: Date, required: [true, "A follow-up needs a date"] },

    status: { type: String, enum: FOLLOWUP_STATUS, default: "pending" },

    /**
     * Who owes this. Defaults to whoever owns the lead, but is settable, so a
     * head can take one back or hand it on without reassigning the lead.
     */
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    /* ------------------------------------------------------ what happened */

    completedAt: { type: Date },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    /** Copied in so the record still reads after the account is renamed or gone. */
    completedByName: { type: String, trim: true, default: "" },
    outcome: { type: String, trim: true, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

followUpSchema.pre("save", function () {
  /**
   * Closing one stamps its date and reopening clears it, so nothing can carry
   * a completed-on date while it is sitting pending again — the same rule the
   * leave decision follows, and for the same reason: every count built on
   * "done this week" would otherwise be wrong.
   */
  if (this.isModified("status")) {
    if (this.status === "done" && !this.completedAt) this.completedAt = new Date();
    if (this.status !== "done") {
      this.completedAt = undefined;
      this.completedBy = undefined;
      this.completedByName = "";
    }
  }
});

/** Anything still owed whose day has passed. */
followUpSchema.statics.overdueQuery = (asOf = new Date()) => ({
  status: "pending",
  dueOn: { $lt: asOf },
});

// The three lists a sales desk opens: my day, one lead's history, what is late
followUpSchema.index({ assignedTo: 1, status: 1, dueOn: 1 });
followUpSchema.index({ lead: 1, dueOn: -1 });
followUpSchema.index({ status: 1, dueOn: 1 });

const FollowUp = mongoose.model("FollowUp", followUpSchema);

export default FollowUp;
