import mongoose from "mongoose";

/**
 * What the customer actually asked for, written down properly.
 *
 * Lead.requirement is a single free-text field and it stays — it is the line
 * somebody types in the first thirty seconds of a call, and that is worth
 * having. What it cannot do is survive the handover: a project team reading
 * "needs a website, maybe an app" has no scope, no budget, no timeline and no
 * idea which of the three things mentioned were agreed and which were mused
 * about.
 *
 * So this is the structured version, captured once the conversation is real.
 * It is what a quotation is built from and what the delivery team inherits
 * when the deal is won, which is why it carries a status of its own: a
 * requirement can be quoted, approved, or dropped without the lead moving.
 *
 * The collection name matches `requirements`, which already exists in this
 * database from an earlier build with no code behind it.
 */

export const REQUIREMENT_STATUS = ["open", "quoted", "approved", "dropped"];

export const REQUIREMENT_PRIORITY = ["low", "medium", "high"];

/** One line of what was asked for. Embedded — an item has no life of its own. */
const requirementItemSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, required: true },
    detail: { type: String, trim: true, default: "" },
    /** Rough sizing, in whatever unit the team estimates in. */
    quantity: { type: Number, default: 1, min: 0 },
    mustHave: { type: Boolean, default: true },
  },
  { _id: true }
);

const requirementSchema = new mongoose.Schema(
  {
    /** One of these two, the same rule FollowUp and SalesActivity follow. */
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead" },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },

    title: { type: String, trim: true, required: [true, "Give the requirement a title"] },
    summary: { type: String, trim: true, default: "" },

    /** Which of the studio's services this maps to, for the rate card. */
    services: { type: [String], default: [] },

    items: { type: [requirementItemSchema], default: [] },

    budgetFrom: { type: Number, default: 0, min: 0 },
    budgetTo: { type: Number, default: 0, min: 0 },

    /** As the customer put it — "before Diwali", "6 weeks". Not a date. */
    timeline: { type: String, trim: true, default: "" },
    expectedStart: { type: Date },

    priority: { type: String, enum: REQUIREMENT_PRIORITY, default: "medium" },
    status: { type: String, enum: REQUIREMENT_STATUS, default: "open" },

    /** Set when a quotation was raised from this. */
    quotation: { type: mongoose.Schema.Types.ObjectId, ref: "Quotation" },

    /**
     * Carried into the project when the deal is won, so delivery reads the
     * agreed scope rather than reconstructing it from the quotation total.
     */
    handedToProject: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },

    notes: { type: String, trim: true, default: "" },

    capturedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    capturedByName: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

requirementSchema.pre("save", function () {
  /**
   * A budget range that runs backwards is nearly always two numbers typed into
   * the wrong boxes, and it makes every "pipeline worth" sum read oddly. Fixed
   * rather than refused: the intent is obvious and refusing costs somebody a
   * form they have already filled in.
   */
  if (this.budgetFrom && this.budgetTo && this.budgetTo < this.budgetFrom) {
    const low = this.budgetTo;
    this.budgetTo = this.budgetFrom;
    this.budgetFrom = low;
  }
});

requirementSchema.index({ lead: 1, createdAt: -1 });
requirementSchema.index({ client: 1, createdAt: -1 });
requirementSchema.index({ status: 1, priority: 1 });

const Requirement = mongoose.model("Requirement", requirementSchema);

export default Requirement;
