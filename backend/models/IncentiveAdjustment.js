import mongoose from "mongoose";

/**
 * Points added or taken away by a person rather than by the rules.
 *
 * The scheme scores tasks, and tasks are not the whole job. Somebody covers a
 * colleague's week, rescues a client call, or spends three days on a problem
 * that never became a ticket — none of that is in the task list, and a scheme
 * that cannot recognise it teaches people to only do things that are ticketed.
 * The reverse case exists too and is why deductions are possible.
 *
 * Deliberately a separate record from the computed score, never a correction
 * applied to it. The task-derived points stay exactly what the tasks say; an
 * adjustment sits beside them with a name and a reason attached. Anyone
 * looking at a total can therefore always see which part the system worked out
 * and which part a person decided — and a reason is required, because an
 * unexplained deduction is the fastest way to make an incentive scheme
 * resented.
 */

const incentiveAdjustmentSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Choose who this is for"],
    },

    /**
     * The month it belongs to, as "YYYY-MM". A string rather than a date
     * because that is what it is — an adjustment is against a period, not an
     * instant, and storing a date invites timezone questions that have no
     * answer here.
     */
    period: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}$/, "A period looks like 2026-09"],
    },

    /** Positive to award, negative to deduct. Zero is refused as meaningless. */
    points: {
      type: Number,
      required: [true, "Say how many points"],
      validate: {
        validator: (v) => v !== 0,
        message: "An adjustment of zero points does nothing",
      },
    },

    reason: { type: String, trim: true, required: [true, "Give a reason"] },

    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Copied in so the record still reads after the account is renamed or gone
    byName: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

// One person's month, and a whole month across everybody
incentiveAdjustmentSchema.index({ employee: 1, period: 1 });
incentiveAdjustmentSchema.index({ period: 1, createdAt: -1 });

const IncentiveAdjustment = mongoose.model("IncentiveAdjustment", incentiveAdjustmentSchema);

export default IncentiveAdjustment;
