import mongoose from "mongoose";

/**
 * A number somebody has agreed to hit, in a month.
 *
 * The thing that makes this worth having rather than a spreadsheet is that
 * most of these can count themselves. Revenue closed, payments collected,
 * leads won, tasks finished — the panel already holds every one of those, so a
 * target set against them updates on its own and is right on the 3rd of the
 * month rather than on the day somebody remembers to total it up.
 *
 * What cannot be counted is set by hand, and says so. A hiring target has no
 * source in this app, so it is a number a person types — which is honest, and
 * better than inventing a proxy for it.
 */

/**
 * Where the actual figure comes from.
 *
 * Each auto metric names a query the controller knows how to run. Adding one
 * means teaching it that query; the rest of the model does not change.
 */
export const TARGET_METRICS = [
  // Sales — every one of these is already in the CRM
  { key: "revenue_closed", label: "Revenue invoiced", unit: "currency", auto: true, team: "sales" },
  { key: "payments_collected", label: "Payments collected", unit: "currency", auto: true, team: "sales" },
  { key: "leads_won", label: "Leads won", unit: "count", auto: true, team: "sales" },
  { key: "leads_added", label: "New leads added", unit: "count", auto: true, team: "sales" },
  { key: "quotations_sent", label: "Quotations sent", unit: "count", auto: true, team: "sales" },

  // Operations — from the task board and the projects
  { key: "tasks_completed", label: "Tasks completed", unit: "count", auto: true, team: "operations" },
  { key: "projects_delivered", label: "Projects delivered", unit: "count", auto: true, team: "operations" },
  { key: "releases_shipped", label: "App releases shipped", unit: "count", auto: true, team: "operations" },

  // HR — nothing in this app counts hiring, so these are entered
  { key: "hires_made", label: "People hired", unit: "count", auto: false, team: "hr" },
  { key: "positions_open", label: "Positions still open", unit: "count", auto: false, team: "hr" },
  { key: "attendance_rate", label: "Attendance rate", unit: "percent", auto: true, team: "hr" },

  // Anything else
  { key: "custom", label: "Something else", unit: "count", auto: false, team: "other" },
];

export const METRIC_KEYS = TARGET_METRICS.map((metric) => metric.key);

export const TARGET_STATUS = ["open", "hit", "missed", "cancelled"];

const targetSchema = new mongoose.Schema(
  {
    /**
     * A target belongs to a team, a person, or both — a team target of
     * ₹10 lakh with five people carrying ₹2 lakh each is the ordinary shape,
     * and both rows are real.
     */
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    title: { type: String, trim: true, default: "" },

    metric: { type: String, enum: METRIC_KEYS, required: true },
    /** Only used when metric is "custom" — what this number actually is. */
    customLabel: { type: String, trim: true, default: "" },

    targetValue: { type: Number, required: true, min: 0 },

    /**
     * The figure for a metric nobody can count automatically. Ignored entirely
     * for auto metrics, which are computed on read — storing those would mean
     * a number that is only as fresh as the last time somebody opened the page.
     */
    manualValue: { type: Number, default: 0, min: 0 },

    /* -------------------------------------------------------- the period */

    /**
     * Month by month, because that is the rhythm a studio actually works to —
     * salaries, retainers, AdMob payouts and client invoices all land monthly.
     * Stored as two numbers rather than a date range so "this month" is a
     * lookup rather than an interval comparison.
     */
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },

    status: { type: String, enum: TARGET_STATUS, default: "open" },

    /** Filled in when the month is closed off and somebody says how it went. */
    reviewNote: { type: String, trim: true, default: "" },
    closedAt: { type: Date },

    setBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    setByName: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

// One target per metric per owner per month — setting it twice is a mistake,
// not two targets. A team-wide row and a personal row differ by `owner`.
targetSchema.index({ year: 1, month: 1, team: 1, owner: 1, metric: 1 }, { unique: true });
targetSchema.index({ owner: 1, year: -1, month: -1 });
targetSchema.index({ team: 1, year: -1, month: -1 });

const Target = mongoose.model("Target", targetSchema);

export default Target;
