import mongoose from "mongoose";

/**
 * A report travelling up the company, and the answer travelling back down.
 *
 * The chain the business actually runs on:
 *
 *   Team Member  --member_update-->  Manager
 *   Manager      --team_update---->  HR
 *   HR           --hr_report------>  Admin
 *
 * One model rather than three, because it is one journey. A team update is a
 * manager's account of the member updates they received; an HR report is HR's
 * account of the team updates they received. `sources` is what makes that
 * literal — each report names the ones underneath it, so an admin reading the
 * top of the chain can open the individual week that produced a number.
 *
 * Three separate models would have made that join a convention rather than a
 * reference, and the whole value of the thing is being able to follow it.
 */

export const REPORT_KINDS = ["member_update", "team_update", "hr_report"];

/**
 * Where each kind goes, and who writes it. Kept here rather than scattered
 * through the controllers so the chain is described in one place.
 */
export const REPORT_CHAIN = {
  member_update: { from: "Team member", to: "Manager", next: "team_update" },
  team_update: { from: "Manager", to: "HR", next: "hr_report" },
  hr_report: { from: "HR", to: "Admin", next: null },
};

/**
 * draft      being written, nobody has seen it
 * submitted  sent up, waiting on the person above
 * reviewed   they have read it and said something
 * responded  they have answered it — the response is what comes back down
 *
 * "reviewed" and "responded" are separate because a manager acknowledging a
 * member's week is not the same act as answering the question in it, and a
 * report that was read but never answered is exactly the thing people complain
 * about. The two are counted separately for that reason.
 */
export const REPORT_STATUS = ["draft", "submitted", "reviewed", "responded"];

/** Which department this belongs to. Mirrors Team.kind. */
export const REPORT_DEPARTMENTS = ["hr", "sales", "operations", "accounts", "marketing", "other"];

/** A read, or an answer. Both record who and when, because both are decisions. */
const actionSchema = new mongoose.Schema(
  {
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Copied in so the record still reads after an account is renamed or gone
    byName: { type: String, trim: true, default: "" },
    byRole: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },
    at: { type: Date },
  },
  { _id: false }
);

const reportSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: REPORT_KINDS, required: true },

    title: { type: String, trim: true, required: [true, "Give the report a title"] },

    /** The body. What happened, in the words of whoever it happened to. */
    summary: { type: String, trim: true, default: "" },

    /**
     * The two lists that make a report worth reading rather than filing.
     *
     * Blockers especially: an update with nothing in the way is a status
     * line, and an update naming something in the way is a request. The
     * dashboards count blockers separately for exactly that reason.
     */
    highlights: { type: [String], default: [] },
    blockers: { type: [String], default: [] },

    /**
     * Whatever numbers this level actually carries — tasks closed, leads won,
     * days attended. Free-form, because a sales manager and an operations
     * manager do not report the same figures and forcing them into one schema
     * would mean half of it is always empty.
     */
    metrics: { type: Map, of: Number, default: {} },

    /* ----------------------------------------------------------- the who */

    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, trim: true, default: "" },
    authorRole: { type: String, trim: true, default: "" },

    /** Who it was sent to. The person one step up the chain. */
    submittedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    submittedToName: { type: String, trim: true, default: "" },

    /* --------------------------------------------------------- the where */

    /**
     * The department this belongs to, and the team it came from.
     *
     * Both, because the department outlives the team: a team can be renamed,
     * split or closed, and a year of Sales reports should still add up to
     * Sales. The kind is copied at submission for that reason rather than
     * being read back through the team every time.
     */
    department: { type: String, enum: REPORT_DEPARTMENTS, default: "other" },
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },

    /* -------------------------------------------------------- the period */

    /**
     * Month by month, matching Target — salaries, retainers and client
     * invoices all land monthly, so it is the rhythm everything else in this
     * app is already keyed to.
     */
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },

    /* --------------------------------------------------------- the chain */

    /**
     * The reports underneath this one.
     *
     * A team update names the member updates it summarises; an HR report
     * names the team updates. This is what lets somebody at the top open the
     * individual week behind a figure instead of taking it on trust.
     */
    sources: [{ type: mongoose.Schema.Types.ObjectId, ref: "Report" }],

    /** The report above, once this one has been rolled up into it. */
    rolledInto: { type: mongoose.Schema.Types.ObjectId, ref: "Report" },

    status: { type: String, enum: REPORT_STATUS, default: "draft" },

    submittedAt: { type: Date },
    review: { type: actionSchema, default: () => ({}) },
    response: { type: actionSchema, default: () => ({}) },
  },
  { timestamps: true }
);

reportSchema.pre("save", function () {
  if (this.isModified("status")) {
    if (this.status === "submitted" && !this.submittedAt) this.submittedAt = new Date();
    // Going back to draft un-sends it; a report sitting in somebody's inbox
    // that the author has since pulled back is worse than no report
    if (this.status === "draft") this.submittedAt = undefined;
  }
});

/** Has anybody above actually answered this, or only read it? */
reportSchema.methods.isAnswered = function isAnswered() {
  return this.status === "responded" && Boolean(this.response?.at);
};

// The three questions every screen asks: my inbox, my outbox, and a month
reportSchema.index({ submittedTo: 1, status: 1, year: -1, month: -1 });
reportSchema.index({ author: 1, year: -1, month: -1 });
reportSchema.index({ kind: 1, department: 1, year: -1, month: -1 });

const Report = mongoose.model("Report", reportSchema);

export default Report;
