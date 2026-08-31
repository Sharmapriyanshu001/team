import mongoose from "mongoose";

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Name is required"], trim: true },
    company: { type: String, trim: true, default: "" },
    email: { type: String, required: true, lowercase: true, trim: true },
    // Clients sign in to their own portal; set by the admin, blank = no access
    password: { type: String, default: "" },
    portalAccess: { type: Boolean, default: true },
    lastLogin: { type: Date },
    phone: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    gstNumber: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["active", "inactive", "lead"],
      default: "active",
    },
    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

const Client = mongoose.model("Client", clientSchema);

export default Client;
