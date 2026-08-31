import mongoose from "mongoose";

/**
 * The rate card: what the studio sells and what it charges.
 *
 * Small, but it is what stops every quotation being retyped from memory — and
 * retyping is where "₹25,000" becomes "₹2,500" on the one quote the client
 * accepts immediately.
 *
 * The HSN/SAC code lives here rather than being looked up per invoice because
 * it is a property of the service, and getting it wrong is a GST filing
 * problem rather than an invoice problem.
 */

export const BILLING_UNITS = ["fixed", "hour", "day", "month", "year", "page", "app"];

const serviceItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Name is required"], trim: true },
    description: { type: String, trim: true, default: "" },
    category: { type: String, trim: true, default: "" },

    rate: { type: Number, default: 0, min: 0 },
    unit: { type: String, enum: BILLING_UNITS, default: "fixed" },

    /** Services are SAC codes; goods are HSN. One field, since the form is one. */
    hsnSac: { type: String, trim: true, default: "" },

    /** GST rate as a percentage. 18 for most software work in India. */
    taxPercent: { type: Number, default: 18, min: 0, max: 100 },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

serviceItemSchema.index({ active: 1, name: 1 });

const ServiceItem = mongoose.model("ServiceItem", serviceItemSchema);

export default ServiceItem;
