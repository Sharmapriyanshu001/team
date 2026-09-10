import mongoose from "mongoose";

/**
 * An SEO or social engagement for one client.
 *
 * Separate from Project because these are retainers, not deliveries. A build
 * project ends; an SEO engagement runs monthly until somebody stops it, and
 * every number attached to it — rankings, audits, backlinks — is only
 * meaningful as a series over that period. Hanging that off a Project whose
 * status goes to "completed" would orphan the history the month it shipped.
 */

export const SEO_SERVICES = ["seo", "smo", "both"];

export const SEO_STATUS = ["active", "paused", "ended"];

const assignmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedByName: { type: String, trim: true, default: "" },
    assignedByRole: { type: String, trim: true, default: "" },
    assignedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const seoProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Name is required"], trim: true },

    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: [true, "An engagement belongs to a client"],
    },

    website: { type: String, trim: true, default: "" },

    service: { type: String, enum: SEO_SERVICES, default: "seo" },
    status: { type: String, enum: SEO_STATUS, default: "active" },

    /**
     * Who else ranks for the terms this client wants. Kept as plain strings
     * rather than records of their own: nobody manages a competitor, they are
     * just the names you look at when a ranking moves.
     */
    competitors: { type: [String], default: [] },

    startedOn: { type: Date, default: Date.now },
    endedOn: { type: Date },

    /**
     * What the client pays each month. Denormalised here rather than read from
     * an invoice, because the engagement has to know its own worth to be
     * ranked against effort — and because the first invoice usually appears a
     * month after the work starts.
     */
    monthlyFee: { type: Number, default: 0, min: 0 },

    /** Where the monthly report is due, as a day of the month. */
    reportDay: { type: Number, min: 1, max: 28, default: 1 },

    notes: { type: String, trim: true, default: "" },

    operationsManagers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    employees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    assignments: { type: [assignmentSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

seoProjectSchema.index({ client: 1, status: 1 });
seoProjectSchema.index({ status: 1, createdAt: -1 });
seoProjectSchema.index({ operationsManagers: 1 });
seoProjectSchema.index({ employees: 1 });

const SeoProject = mongoose.model("SeoProject", seoProjectSchema);

export default SeoProject;
