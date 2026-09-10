import mongoose from "mongoose";

export const PAY_MODES = ["bank_transfer", "upi", "cash", "cheque", "other"];

/**
 * Money actually handed to somebody.
 *
 * Deliberately a record of a PAYMENT, not a running balance on the employee.
 * What they have earned is worked out from the attendance sheet every time it
 * is asked for — see utils/salary.js — and what they have been given is the
 * sum of these rows. A stored "balance" field would be a third number that
 * disagrees with both the first time an attendance mark is corrected, which
 * happens constantly.
 *
 * So: earned is computed, paid is summed, and the difference is what is owed.
 * Nothing here can drift out of step with the sheet it describes.
 */
const salaryPaymentSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "A payment belongs to somebody"],
    },

    amount: {
      type: Number,
      required: [true, "How much was paid?"],
      min: [1, "A payment has to be more than zero"],
    },

    /**
     * When the money left, not when the row was typed. Somebody entering
     * Friday's cash on Monday must be able to say Friday, or the month it
     * falls in is decided by when the admin got round to it.
     */
    paidOn: { type: Date, default: Date.now },

    mode: { type: String, enum: PAY_MODES, default: "bank_transfer" },

    /** A UTR, a cheque number — whatever makes it findable in the bank. */
    reference: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },

    /**
     * Who recorded it, kept as a name beside the reference.
     *
     * The name is copied rather than only referenced because this is the row
     * somebody points at in a disagreement about wages, and it has to still
     * read correctly after the account that entered it is closed.
     */
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    recordedByName: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

/** "What has this person been paid, newest first" — the only question asked. */
salaryPaymentSchema.index({ employee: 1, paidOn: -1 });

const SalaryPayment = mongoose.model("SalaryPayment", salaryPaymentSchema);

export default SalaryPayment;
