import mongoose from "mongoose";

/**
 * One login, kept where it can be found and not where it can be read.
 *
 * This exists because the alternative is what every studio actually does: a
 * spreadsheet, a pinned WhatsApp message, or one person's memory. All three
 * share the same two failures — anybody who reaches them reaches everything,
 * and nobody can say afterwards who looked.
 *
 * So the secret is encrypted with a key that lives only in the server's
 * environment (see utils/secretBox.js), it is never included in any list
 * response, and reading it is a separate act that is written down here.
 */

export const CREDENTIAL_TYPES = [
  "play_console",
  "hosting",
  "cpanel",
  "ftp",
  "domain",
  "database",
  "wordpress",
  "social",
  "email",
  "api_key",
  "other",
];

/**
 * Who opened this, and when.
 *
 * Capped at the most recent entries rather than kept forever: the question
 * people ask is "who has seen this lately", and an unbounded array on a
 * document that is read often is a document that grows without limit.
 */
const accessSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    userName: { type: String, trim: true, default: "" },
    userRole: { type: String, trim: true, default: "" },
    at: { type: Date, default: Date.now },
    action: { type: String, enum: ["revealed", "updated", "created"], default: "revealed" },
  },
  { _id: false }
);

const credentialSchema = new mongoose.Schema(
  {
    label: { type: String, required: [true, "A name is required"], trim: true },
    type: { type: String, enum: CREDENTIAL_TYPES, default: "other" },

    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },

    url: { type: String, trim: true, default: "" },
    username: { type: String, trim: true, default: "" },

    /**
     * The ciphertext. Named for what it is so nobody reads a log line
     * containing it and assumes they are looking at a password.
     */
    secretSealed: { type: String, default: "" },

    /** Recovery codes, API tokens, the second half of a 2FA setup. */
    notesSealed: { type: String, default: "" },

    /**
     * A hint, in the clear, so the list is useful without opening anything —
     * "the usual one", "in Bitwarden under Acme". Deliberately not validated:
     * it is a note to a colleague, not a field.
     */
    hint: { type: String, trim: true, default: "" },

    /**
     * Who may open it. Empty means admins only, which is the safe default for
     * a record created without anybody thinking about it.
     */
    sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    /** Some logins genuinely expire — domain panels, API keys, certificates. */
    expiresAt: { type: Date },

    status: { type: String, enum: ["active", "rotated", "retired"], default: "active" },

    lastRotatedAt: { type: Date },
    accessLog: { type: [accessSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

credentialSchema.index({ client: 1, type: 1 });
credentialSchema.index({ sharedWith: 1 });
credentialSchema.index({ expiresAt: 1 });

/**
 * A projection that cannot leak. Every list and detail response is built from
 * this, so adding a field to the model never accidentally publishes a secret —
 * the two sealed fields have to be asked for by name, by the one handler that
 * is allowed to.
 */
credentialSchema.methods.safe = function safe() {
  return {
    _id: this._id,
    label: this.label,
    type: this.type,
    client: this.client,
    project: this.project,
    url: this.url,
    username: this.username,
    hint: this.hint,
    sharedWith: this.sharedWith,
    expiresAt: this.expiresAt,
    status: this.status,
    lastRotatedAt: this.lastRotatedAt,
    hasSecret: Boolean(this.secretSealed),
    hasNotes: Boolean(this.notesSealed),
    lastAccess: this.accessLog?.[this.accessLog.length - 1] || null,
    accessCount: this.accessLog?.length || 0,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const Credential = mongoose.model("Credential", credentialSchema);

export default Credential;
