import mongoose from "mongoose";

// Single document holding the panel-wide settings.
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: "general", unique: true },
    companyName: { type: String, trim: true, default: "JHA Company" },
    companyEmail: { type: String, trim: true, default: "" },
    companyPhone: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    website: { type: String, trim: true, default: "" },
    currency: { type: String, trim: true, default: "INR" },
    timezone: { type: String, trim: true, default: "Asia/Kolkata" },
    workingHours: { type: String, trim: true, default: "09:30 - 18:30" },

    /* ------------------------------------------------------------ invoicing */

    /**
     * The studio's own GST details, which every invoice is raised from.
     *
     * The state code is what decides CGST+SGST against IGST — it is compared
     * with the client's, taken from the first two digits of their GSTIN. Left
     * blank, every supply is treated as intra-state, which is the right guess
     * for a studio that has not filled this in yet and is billing locally.
     */
    gstNumber: { type: String, trim: true, uppercase: true, default: "" },
    stateCode: { type: String, trim: true, default: "" },
    panNumber: { type: String, trim: true, uppercase: true, default: "" },

    // Invoice numbers read "<prefix>/<financial year>/<serial>"
    invoicePrefix: { type: String, trim: true, default: "INV" },
    quotationPrefix: { type: String, trim: true, default: "QT" },

    invoiceTerms: { type: String, trim: true, default: "" },
    /** Bank details printed in the invoice footer. */
    payToDetails: { type: String, trim: true, default: "" },

    emailNotifications: { type: Boolean, default: true },
    taskReminders: { type: Boolean, default: true },
    // Controls the "Client" tab in each panel's Chat section
    leaderClientChat: { type: Boolean, default: true },
    employeeClientChat: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Setting = mongoose.model("Setting", settingSchema);

export default Setting;
