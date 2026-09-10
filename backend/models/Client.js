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

    /* ------------------------------------------- where this client came from */

    /**
     * The lead that became this client, if one did.
     *
     * convertLead already wrote the link in the other direction — the lead
     * knows its client — which is enough to stop a lead being converted twice
     * and useless for the question anybody actually asks, which is "where did
     * this client come from and who closed them". Walking every lead looking
     * for a matching id to answer that is not a relation, it is a search.
     *
     * Blank on every client added by hand, which is honest: nothing sold them.
     */
    sourceLead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead" },

    /**
     * Work we already did for them.
     *
     * A returning customer is the ordinary case for a studio — the same people
     * come back for version two of an app, or a second site on the same brand
     * — and until there is a record of it, whoever picks the new job up starts
     * from nothing and asks the client questions they have already answered.
     *
     * Set once, on the client, rather than on every project: the admin answers
     * "have we built for them before" when the client record is made, and
     * projectsBeforeSave carries the answer onto each project created for them
     * afterwards. Blank means no, which is most clients.
     */
    previousProject: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },

    /** Whoever on Sales owns the relationship — renewals, the next quote. */
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    /* ------------------------------------------------- the handover to Ops */

    /**
     * A won deal is not delivery. Somebody in Operations has to pick the work
     * up, and until they have, the client is sitting between two departments
     * with nobody answering for them — which is exactly the gap this records.
     *
     * `handedOverAt` unset means Sales still holds it. That makes "closed but
     * not started" a question the panel can answer rather than one somebody
     * notices three weeks later.
     */
    accountManager: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    handedOverAt: { type: Date },
    handedOverBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    handoverNote: { type: String, trim: true, default: "" },

    /**
     * Sales passing a new client on to HR.
     *
     * A sales person who signs somebody up has details HR needs and has no
     * other way to hand over: the company name, who to invoice, the GST
     * number, what was agreed. Before this they were retyped into a message,
     * or not passed on at all.
     *
     * Recorded on the client rather than sent as a notification alone, because
     * a notification scrolls away and the question HR actually asks later is
     * "has this one come through to us yet". Unset means it has not.
     */
    sharedWithHr: {
      at: { type: Date },
      by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      // Copied in so the record still reads after the account is renamed or gone
      byName: { type: String, trim: true, default: "" },
      note: { type: String, trim: true, default: "" },
    },
  },
  { timestamps: true }
);

// The two lists Sales and Operations open: mine, and what is not yet picked up
clientSchema.index({ owner: 1, status: 1 });
clientSchema.index({ accountManager: 1 });

const Client = mongoose.model("Client", clientSchema);

export default Client;
