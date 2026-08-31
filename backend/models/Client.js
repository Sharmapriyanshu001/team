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

    /**
     * Bumped whenever every existing session for this account should stop
     * working: a sign-out, a password change, an admin resetting the password.
     *
     * A JWT cannot be recalled — once signed it is valid until it expires, and
     * these last seven days. So the token carries the number it was minted
     * with and the auth middleware compares it against this one; a token from
     * before the bump no longer matches and is refused.
     *
     * Tokens issued before this field existed carry no number at all, and are
     * read as 0 so that adding this did not sign everybody out mid-week.
     */
    tokenVersion: { type: Number, default: 0 },
    phone: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    gstNumber: { type: String, trim: true, uppercase: true, default: "" },
    /**
     * Only needed for a client with no GSTIN — for everybody else it is the
     * first two digits of that number, and deriving it beats keeping a second
     * copy that can disagree.
     */
    stateCode: { type: String, trim: true, default: "" },
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
