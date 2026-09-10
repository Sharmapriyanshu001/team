import mongoose from "mongoose";

/**
 * How points are earned and lost, and what they are worth as a bonus.
 *
 * Kept as a record rather than as constants because these are exactly the
 * numbers a company changes — a quarter where delivery matters more, a bonus
 * pot that grew — and every one of those is an HR decision, not a deployment.
 *
 * One active rule at a time. Deliberately not versioned by date: this is a
 * small company's incentive scheme, and the honest tradeoff is written down
 * here rather than hidden. Changing the numbers re-scores past months too,
 * because points are computed from the tasks rather than banked. That is the
 * right default — it means the scheme can never disagree with the work it
 * describes — but it does mean a rule change should be announced, not slipped
 * in halfway through a month.
 */

/** One step of the bonus ladder: reach the points, earn the amount. */
const bonusSlabSchema = new mongoose.Schema(
  {
    minPoints: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    label: { type: String, trim: true, default: "" },
  },
  { _id: true }
);

const incentiveRuleSchema = new mongoose.Schema(
  {
    /** One document holds the live scheme. */
    key: { type: String, default: "default", unique: true, trim: true },

    name: { type: String, trim: true, default: "Monthly incentive" },
    active: { type: Boolean, default: true },

    /* ------------------------------------------------------ earning points */

    /**
     * Finishing the work at all. Separate from the on-time bonus so a task
     * delivered late still counts for something — a scheme where late work
     * scores the same as no work is a scheme that teaches people to abandon
     * anything that slips.
     */
    completedPoints: { type: Number, default: 5 },

    /** On or before the due date. The point of the whole thing. */
    onTimeBonus: { type: Number, default: 5 },

    /**
     * A flat deduction for finishing late, plus a per-day amount so a week
     * late is not the same as an hour late. Capped, because a task forgotten
     * for three months should not wipe out a good quarter by itself.
     */
    latePenalty: { type: Number, default: 5 },
    latePerDay: { type: Number, default: 1 },
    lateMaxPenalty: { type: Number, default: 15 },

    /**
     * Still open, and the day has gone. This is the one that is not an event:
     * nothing happens in the app when a deadline passes, so it is counted from
     * the state of the task rather than written down when it occurs.
     */
    overduePenalty: { type: Number, default: 5 },

    /**
     * Work the leader rated well. Timeliness alone rewards rushing something
     * out; this is the counterweight.
     */
    qualityMinRating: { type: Number, default: 4, min: 0, max: 5 },
    qualityBonus: { type: Number, default: 3 },

    /* -------------------------------------------------------- the payout */

    /**
     * Highest slab whose minPoints the person reached. Empty means points are
     * tracked but pay nothing yet, which is a reasonable way to run the scheme
     * for a month before money is attached to it.
     */
    bonusSlabs: { type: [bonusSlabSchema], default: [] },

    notes: { type: String, trim: true, default: "" },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedByName: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

/**
 * The live scheme, creating the default one the first time anybody asks.
 *
 * Defaults rather than an empty document, so the first person to open the
 * screen sees a working scheme they can adjust instead of a blank form and a
 * decision to make.
 */
incentiveRuleSchema.statics.current = async function current() {
  const existing = await this.findOne({ key: "default" });
  if (existing) return existing;

  return this.create({
    key: "default",
    bonusSlabs: [
      { minPoints: 40, amount: 1000, label: "Met the mark" },
      { minPoints: 70, amount: 3000, label: "Strong month" },
      { minPoints: 100, amount: 6000, label: "Outstanding" },
    ],
  });
};

const IncentiveRule = mongoose.model("IncentiveRule", incentiveRuleSchema);

export default IncentiveRule;
