import mongoose from "mongoose";

/**
 * Time off: asked for, decided on, and counted.
 *
 * Attendance already records that somebody was away — this records that it was
 * agreed beforehand, which is the difference between a day off and an absence.
 * The two meet in the HR screens: approving a leave is what stops the days it
 * covers from reading as absent.
 *
 * The field names here match rows that are already in this database. An
 * earlier build wrote them and left no model behind, so the choice was between
 * matching what is there and stranding real applications; this matches.
 */

/**
 * The kinds of leave this company grants.
 *
 * "paid" and "work_from_home" are not tidy additions — they are what the live
 * database actually contains. There are leave rows filed as "paid" and leave
 * policies typed "work_from_home", written by an earlier build. A mongoose
 * enum validates on write and not on read, so leaving them out did not hide
 * those rows: it let HR open one and then threw a ValidationError the moment
 * they approved or edited it, which is the worst of both.
 */
export const LEAVE_TYPES = [
  "casual",
  "sick",
  "earned",
  "paid",
  "unpaid",
  "half_day",
  "work_from_home",
  "maternity",
  "paternity",
  "bereavement",
  "other",
];

export const LEAVE_STATUS = ["pending", "approved", "rejected", "cancelled"];

const leaveSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Choose who this leave is for"],
    },

    type: { type: String, enum: LEAVE_TYPES, default: "casual" },

    fromDate: { type: Date, required: [true, "A start date is required"] },
    toDate: { type: Date, required: [true, "An end date is required"] },

    /**
     * Worked out from the dates on save rather than typed, so the number a
     * balance is built from cannot disagree with the dates beside it. A half
     * day is the one case where it is not a whole number.
     */
    days: { type: Number, default: 0, min: 0 },

    reason: { type: String, trim: true, default: "" },

    status: { type: String, enum: LEAVE_STATUS, default: "pending" },

    /* --------------------------------------------------------- the decision */

    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Copied in so the record still reads after the account is renamed or gone
    decidedByName: { type: String, trim: true, default: "" },
    decidedAt: { type: Date },
    decisionNote: { type: String, trim: true, default: "" },

    /** Who filed it — HR entering it on somebody's behalf, usually. */
    appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

/**
 * How many days a request covers.
 *
 * Whole days, inclusive of both ends, except a half day which is always 0.5
 * however the dates are set — that is what "half day" means and letting it be
 * anything else makes every balance built on it wrong.
 */
export const countLeaveDays = (from, to, type) => {
  if (type === "half_day") return 0.5;

  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const span = Math.round((end - start) / 86400000) + 1;
  return span > 0 ? span : 0;
};

leaveSchema.pre("save", function () {
  if (this.isModified("fromDate") || this.isModified("toDate") || this.isModified("type")) {
    this.days = countLeaveDays(this.fromDate, this.toDate, this.type);
  }
  // A decision stamps its own date, and reopening a request clears it, so
  // nothing can carry a decided-on date while it is sitting pending again.
  if (this.isModified("status")) {
    this.decidedAt = ["approved", "rejected"].includes(this.status) ? new Date() : undefined;
  }
});

// The two lists HR actually opens: what is waiting, and one person's history
leaveSchema.index({ status: 1, fromDate: -1 });
leaveSchema.index({ employee: 1, fromDate: -1 });

const Leave = mongoose.model("Leave", leaveSchema);

export default Leave;
