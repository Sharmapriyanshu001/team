import mongoose from "mongoose";

/**
 * A warning, strike or suspension from Google — against a console or one app.
 *
 * This is the model that exists because of what it costs not to have it. Play
 * policy notices arrive by email to whichever account owns the console, carry
 * a deadline, and escalate to a suspended developer account if that deadline
 * passes. An inbox nobody has been made responsible for is where they go to be
 * missed, and a suspended console takes every app on it down at once.
 *
 * So a notice becomes a row with an owner and a date, and the dashboard counts
 * the ones still open.
 */

export const ALERT_TYPES = [
  "warning",
  "strike",
  "rejection",
  "suspension",
  "data_safety",
  "policy_update",
];

export const ALERT_SEVERITY = ["low", "medium", "high", "critical"];

export const ALERT_STATUS = ["open", "in_progress", "resolved", "escalated"];

const policyAlertSchema = new mongoose.Schema(
  {
    /**
     * A notice is about a console, an app, or both — a strike lands on the
     * console because of something one app did. Neither is required on its
     * own; the controller insists on at least one.
     */
    console: { type: mongoose.Schema.Types.ObjectId, ref: "DeveloperConsole" },
    app: { type: mongoose.Schema.Types.ObjectId, ref: "PublishedApp" },

    type: { type: String, enum: ALERT_TYPES, default: "warning" },
    severity: { type: String, enum: ALERT_SEVERITY, default: "medium" },
    status: { type: String, enum: ALERT_STATUS, default: "open" },

    title: { type: String, required: [true, "A short title is required"], trim: true },
    detail: { type: String, trim: true, default: "" },

    // What Google called it, e.g. "Deceptive Behaviour", so two notices about
    // the same policy can be recognised as the same problem
    policyName: { type: String, trim: true, default: "" },

    raisedOn: { type: Date, default: Date.now },

    /** The date the account is in trouble if nothing has been done. */
    deadline: { type: Date },

    // Who is dealing with it. An alert with nobody on it is the failure mode
    // this model exists to prevent, so the list screen sorts these to the top.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolution: { type: String, trim: true, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// "What is still open, soonest deadline first" is the only question that matters
policyAlertSchema.index({ status: 1, deadline: 1 });
policyAlertSchema.index({ console: 1, status: 1 });
policyAlertSchema.index({ app: 1, status: 1 });

const PolicyAlert = mongoose.model("PolicyAlert", policyAlertSchema);

export default PolicyAlert;
