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
