import mongoose from "mongoose";

import { LEAVE_TYPES } from "./Leave.js";

/**
 * How much of each kind of leave a year holds, and the rules around taking it.
 *
 * Kept as records rather than constants because these are the numbers a
 * company changes — a quota goes up, carry-forward gets capped — and every one
 * of those is an HR decision, not a deployment.
 *
 * Field names match the rows already in this database, written by an earlier
 * build. See models/Leave.js for why.
 */

const leavePolicySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: [true, "A name is required"] },

    /**
     * What the policy is, in the company's own words.
     *
     * Separate from `notes` on purpose: this is the sentence an employee reads
     * on their own leave screen when deciding which kind to ask for — "for
     * illness, no notice needed" — while notes is the internal aside HR keeps
     * beside it. Folding them into one field meant either the employee saw
     * something not written for them, or nobody wrote the explanation at all.
     */
    description: { type: String, trim: true, default: "" },

    /**
     * One policy per type, which the database enforces with a unique index on
     * this field. Two "casual leave" policies would mean two answers to how
     * many casual days a year holds, and every balance built on them would
     * depend on which one was read first.
     *
     * Declared without `unique: true` on purpose: the index already exists on
     * the collection, and asking Mongoose to build it again on a live database
     * is a write this model has no reason to make. hrController checks for the
     * clash before saving so the refusal names the policy in the way.
     */
    type: { type: String, enum: LEAVE_TYPES, default: "casual" },

    /** Days a full year grants. Zero means uncapped, or counted elsewhere. */
    annualQuota: { type: Number, default: 0, min: 0 },

    carryForward: { type: Boolean, default: false },
    carryForwardCap: { type: Number, default: 0, min: 0 },

    /** Zero on either means "no rule", which is how most of them start. */
    maxConsecutiveDays: { type: Number, default: 0, min: 0 },
    noticeDays: { type: Number, default: 0, min: 0 },

    /** Whether the days are paid. Unpaid leave is what drives a salary cut. */
    paid: { type: Boolean, default: true },

    active: { type: Boolean, default: true },

    /**
     * Which designations or departments this applies to. Empty means everyone,
     * which is the right default and the one most policies keep.
     */
    appliesTo: { type: [String], default: [] },

    notes: { type: String, trim: true, default: "" },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

leavePolicySchema.index({ active: 1, type: 1 });

const LeavePolicy = mongoose.model("LeavePolicy", leavePolicySchema);

export default LeavePolicy;
