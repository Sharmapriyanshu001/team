import mongoose from "mongoose";

/**
 * One Google Play developer account.
 *
 * The studio publishes from several of these — some its own, some belonging to
 * a client who signed up themselves and handed over access. Which it is
 * matters more than it looks: a console the studio owns can be moved between
 * clients, and one the client owns cannot, so the two are never merged into a
 * single "account" with a flag nobody reads.
 *
 * Deliberately separate from Project. A console outlives any one project and
 * usually carries several apps for several clients, so hanging it off a
 * project would mean duplicating it the first time that happens.
 */

export const CONSOLE_OWNERSHIP = ["studio", "client"];

export const CONSOLE_STATUS = ["active", "suspended", "terminated", "closed"];

/**
 * Who was given access to this console, by whom, and when.
 *
 * The same shape Project and CodeProject use, and for the same reason: the
 * plain id arrays are what every query reads, and none of them should have to
 * change to learn who did the granting.
 */
const assignmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Copied in so the record still reads after an account is renamed or gone
    assignedByName: { type: String, trim: true, default: "" },
    assignedByRole: { type: String, trim: true, default: "" },
    assignedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const developerConsoleSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Console name is required"], trim: true },

    /**
     * The Google account the console signs in with.
     *
     * Stored, but never the password — that belongs in the credential vault,
     * which encrypts what it holds and writes down who opened it. A console
     * row is a thing to plan work against; it is not somewhere to keep a login.
     */
    accountEmail: { type: String, trim: true, lowercase: true, default: "" },

    // Play's own numeric identifier for the developer account
    developerId: { type: String, trim: true, default: "" },

    ownership: { type: String, enum: CONSOLE_OWNERSHIP, default: "studio" },
    // Set when ownership is "client" — whose account this actually is
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },

    status: { type: String, enum: CONSOLE_STATUS, default: "active" },

    registeredOn: { type: Date },

    /**
     * Play does not publish a hard app limit, but every studio works to one in
     * practice — the number of apps this account is comfortable carrying
     * before it starts drawing attention. Zero means nobody has set one.
     */
    appLimit: { type: Number, default: 0, min: 0 },

    notes: { type: String, trim: true, default: "" },

    /* -------------------------------------------------------- who works on it */

    teamLeaders: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    employees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    assignments: { type: [assignmentSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// The questions the list screens ask
developerConsoleSchema.index({ createdAt: -1 });
developerConsoleSchema.index({ status: 1, createdAt: -1 });
developerConsoleSchema.index({ teamLeaders: 1 });
developerConsoleSchema.index({ employees: 1 });

const DeveloperConsole = mongoose.model("DeveloperConsole", developerConsoleSchema);

export default DeveloperConsole;
