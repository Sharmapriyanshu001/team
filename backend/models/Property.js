import mongoose from "mongoose";

/**
 * Something the studio owns rather than builds for somebody else.
 *
 * A client project and an owned app look alike from the outside — both are
 * code, both take work — but the question you ask of each is opposite. Of a
 * client project: has the invoice been paid. Of this: did it make money, and
 * whose money was it.
 *
 * So it is its own model, and its own section. A Property may point at a
 * PublishedApp (when it is on Play) and at the ad accounts that advertise it,
 * but it is neither of those things: it is the business, and they are two of
 * its moving parts.
 */

export const PROPERTY_KINDS = ["android_app", "ios_app", "website", "game", "other"];

export const PROPERTY_STATUS = ["building", "live", "paused", "retired"];

/**
 * Somebody who owns a share of this.
 *
 * Deliberately not a User. A partner is usually not on the payroll and often
 * has no login — they are a name, a share, and somebody to pay. Where they do
 * have an account, `user` links it; where they do not, the name is enough.
 *
 * Shares are stored as they were agreed and never normalised to add up to 100.
 * A property where the listed partners hold 60% simply means the studio keeps
 * 40, and quietly inflating everybody to fill the gap would be inventing a
 * deal nobody made.
 */
const partnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    sharePercent: { type: Number, required: true, min: 0, max: 100 },

    /**
     * Whether this partner also carries a share of the costs.
     *
     * The two common deals differ exactly here: some partners take a cut of
     * revenue and pay nothing towards ad spend, others split the profit after
     * costs. Getting this wrong is an argument, so it is a field rather than
     * an assumption.
     */
    sharesCosts: { type: Boolean, default: true },

    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },

    joinedOn: { type: Date, default: Date.now },
    active: { type: Boolean, default: true },
  },
  { _id: true, timestamps: true }
);

const propertySchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "A name is required"], trim: true },
    kind: { type: String, enum: PROPERTY_KINDS, default: "android_app" },

    /** Package name for an app, domain for a site. */
    handle: { type: String, trim: true, default: "" },
    url: { type: String, trim: true, default: "" },

    status: { type: String, enum: PROPERTY_STATUS, default: "live" },
    launchedOn: { type: Date },

    /* ---------------------------------------------------- what it plugs into */

    /** The Play record, when this is an app the studio also publishes. */
    publishedApp: { type: mongoose.Schema.Types.ObjectId, ref: "PublishedApp" },

    /**
     * Ad accounts that advertise this property.
     *
     * Linked rather than re-entered, so money spent promoting an owned app is
     * counted once — in the ads module, where it is already recorded day by
     * day — and read from there. Typing it again as an expense here is how a
     * property ends up looking twice as unprofitable as it is.
     */
    adAccounts: [{ type: mongoose.Schema.Types.ObjectId, ref: "AdAccount" }],

    /* --------------------------------------------------------- who owns it */

    partners: { type: [partnerSchema], default: [] },

    baseCurrency: { type: String, trim: true, uppercase: true, default: "INR" },

    notes: { type: String, trim: true, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

/** What the studio keeps, once the listed partners have taken theirs. */
propertySchema.methods.studioShare = function studioShare() {
  const given = (this.partners || [])
    .filter((partner) => partner.active)
    .reduce((sum, partner) => sum + (partner.sharePercent || 0), 0);

  return Math.round((100 - given) * 100) / 100;
};

propertySchema.index({ status: 1, name: 1 });
propertySchema.index({ publishedApp: 1 });

const Property = mongoose.model("Property", propertySchema);

export default Property;
