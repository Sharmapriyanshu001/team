import mongoose from "mongoose";

/**
 * A role the company is trying to fill.
 *
 * The thing that makes this worth having rather than a line in a spreadsheet
 * is that every candidate hangs off it. "How is hiring going" is not a
 * question about candidates, it is a question about openings — three people in
 * the pipeline is good news for one vacancy and bad news for five — and until
 * there is a record of the vacancy itself there is nothing to measure the
 * pipeline against.
 *
 * `positions` is why: an opening for two developers is filled when two people
 * have joined, not when the first one has. The controller counts hires against
 * it and closes the opening on its own when the last seat is taken.
 */

export const OPENING_STATUS = ["draft", "open", "on_hold", "closed", "filled"];

export const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "internship",
  "temporary",
];

const jobOpeningSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, "A job title is required"], trim: true },

    /**
     * A short readable handle — "ENG-01" — so a candidate can be talked about
     * without repeating the whole title. Generated when left blank.
     */
    code: { type: String, trim: true, uppercase: true, default: "" },

    department: { type: String, trim: true, default: "" },
    location: { type: String, trim: true, default: "" },

    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: "full_time" },

    /** How many people this opening is for. Filled when that many have joined. */
    positions: { type: Number, default: 1, min: 1 },

    description: { type: String, trim: true, default: "" },
    requirements: { type: [String], default: [] },
    skills: { type: [String], default: [] },

    /** Free text — "2–4 years" reads better than a pair of numbers nobody set. */
    experience: { type: String, trim: true, default: "" },

    salaryMin: { type: Number, default: 0, min: 0 },
    salaryMax: { type: Number, default: 0, min: 0 },

    status: { type: String, enum: OPENING_STATUS, default: "open" },

    /**
     * The role a hire from this opening is given. Kept here rather than asked
     * again at onboarding, because it is a property of the vacancy — and
     * because the answer should not depend on who happens to be onboarding.
     */
    hireAs: { type: String, trim: true, default: "employee" },

    /** Who on HR is carrying this one. */
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    /** Who the hire will report to, if that is already settled. */
    reportsTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    openedOn: { type: Date, default: Date.now },
    /** When it should be filled by. Drives the "overdue" count on the board. */
    targetDate: { type: Date },
    closedAt: { type: Date },
    closeReason: { type: String, trim: true, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

jobOpeningSchema.pre("save", function () {
  if (this.isModified("status")) {
    // Closing stamps its own date; reopening clears it, so an opening cannot
    // read as closed on a date it is plainly still taking candidates on
    this.closedAt = ["closed", "filled"].includes(this.status) ? new Date() : undefined;
  }
});

/** Still taking candidates. */
jobOpeningSchema.methods.isLive = function isLive() {
  return ["open", "on_hold"].includes(this.status);
};

jobOpeningSchema.index({ status: 1, createdAt: -1 });
jobOpeningSchema.index({ owner: 1, status: 1 });

const JobOpening = mongoose.model("JobOpening", jobOpeningSchema);

export default JobOpening;
