import mongoose from "mongoose";

/**
 * One advertising account on one platform, for one client.
 *
 * The field that matters most here is `funding`. Everything else about running
 * ads is the same whoever is paying — the same campaigns, the same numbers —
 * but who paid decides whether a month's spend is a cost to recover, a balance
 * to draw down, or somebody else's problem entirely. Getting that wrong is how
 * an agency quietly funds a client's advertising for a quarter.
 */

export const AD_PLATFORMS = ["meta", "google", "linkedin", "other"];

export const AD_ACCOUNT_STATUS = ["active", "paused", "disabled", "closed"];

/**
 * Whose money is on the account.
 *
 *   client_card     their card is on the platform. Nothing to recover; the
 *                   studio bills a management fee and that is all.
 *   studio_card     the studio pays the platform and bills it back. Spend is
 *                   a debt owed to the studio until an invoice covers it.
 *   prepaid         the client sends money first and it is spent down. Spend
 *                   is drawn from a balance, and the balance can run out —
 *                   which is a thing somebody has to be warned about.
 */
export const FUNDING_MODES = ["client_card", "studio_card", "prepaid"];

/** How the studio is paid for running it. */
export const FEE_TYPES = ["percent_of_spend", "flat_monthly", "none"];

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

/**
 * Money the client has sent in advance, for a prepaid account.
 *
 * Embedded: a top-up has no meaning apart from the account it credits, and
 * they arrive a few times a month rather than in thousands.
 */
const topupSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    receivedOn: { type: Date, default: Date.now },
    mode: { type: String, trim: true, default: "bank_transfer" },
    reference: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },
    recordedByName: { type: String, trim: true, default: "" },
  },
  { _id: true, timestamps: true }
);

/**
 * A stretch of spend that has been billed back to the client.
 *
 * Kept as periods rather than a single "recovered up to" date so a correction
 * is possible without rewriting history, and so each row can point at the
 * invoice that carried it. Anything spent after the latest period's end is
 * what is still owed — which is the number the account screen leads with.
 */
const recoverySchema = new mongoose.Schema(
  {
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
    invoiceNumber: { type: String, trim: true, default: "" },
    recordedByName: { type: String, trim: true, default: "" },
  },
  { _id: true, timestamps: true }
);

const adAccountSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "A name is required"], trim: true },

    platform: { type: String, enum: AD_PLATFORMS, default: "meta" },

    /**
     * The platform's own identifier — act_1234567890 on Meta, 123-456-7890 on
     * Google. Stored as typed: it is used to find the account in somebody
     * else's interface, so what matters is that it reads back the same.
     */
    externalId: { type: String, trim: true, default: "" },

    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: [true, "An ad account belongs to a client"],
    },

    status: { type: String, enum: AD_ACCOUNT_STATUS, default: "active" },
    currency: { type: String, trim: true, uppercase: true, default: "INR" },

    /* ---------------------------------------------------------- the money */

    funding: { type: String, enum: FUNDING_MODES, default: "client_card" },

    /**
     * What the client has agreed to spend a month. Pacing is measured against
     * this, and zero means nobody has set one — in which case the account is
     * shown without a pacing figure rather than with a misleading one.
     */
    monthlyBudget: { type: Number, default: 0, min: 0 },

    feeType: { type: String, enum: FEE_TYPES, default: "percent_of_spend" },
    /** Percent when feeType is percent_of_spend, rupees when it is flat. */
    feeValue: { type: Number, default: 0, min: 0 },

    // Only meaningful when funding is "prepaid"
    topups: { type: [topupSchema], default: [] },

    // Only meaningful when funding is "studio_card"
    recoveries: { type: [recoverySchema], default: [] },

    /* --------------------------------------------------------- the rest */

    /** The login, in the vault. Never the password itself. */
    credential: { type: mongoose.Schema.Types.ObjectId, ref: "Credential" },

    seoProject: { type: mongoose.Schema.Types.ObjectId, ref: "SeoProject" },

    notes: { type: String, trim: true, default: "" },

    operationsManagers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    employees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    assignments: { type: [assignmentSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

/** Money in, for a prepaid account. Spend is subtracted by the controller. */
adAccountSchema.methods.toppedUp = function toppedUp() {
  return Math.round((this.topups || []).reduce((sum, t) => sum + (Number(t.amount) || 0), 0) * 100) / 100;
};

/** The end of the most recent billed period, or null if nothing has been. */
adAccountSchema.methods.recoveredTo = function recoveredTo() {
  const dates = (this.recoveries || []).map((r) => new Date(r.to).getTime());
  return dates.length ? new Date(Math.max(...dates)) : null;
};

adAccountSchema.index({ client: 1, platform: 1 });
adAccountSchema.index({ status: 1, platform: 1 });
adAccountSchema.index({ operationsManagers: 1 });
adAccountSchema.index({ employees: 1 });

const AdAccount = mongoose.model("AdAccount", adAccountSchema);

export default AdAccount;
