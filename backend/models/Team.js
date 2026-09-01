import mongoose from "mongoose";

/**
 * A department, and the people in it.
 *
 * `User.department` was a free-text field, which is enough to print on a
 * profile and useless for anything else: you cannot ask it who runs Sales, or
 * whose numbers a target belongs to, and two people typing "Operations" and
 * "operations" are in different departments as far as any query is concerned.
 *
 * So a team is a record. It has one manager who answers for its numbers, team
 * leaders who run the day to day, and members who do the work — which is how
 * the three teams a studio actually has are shaped:
 *
 *   HR           hiring, onboarding, attendance, leaves, exits
 *   Sales        leads, quotations, closing, collections
 *   Operations   the delivery itself — development, SEO, ads, Play
 *
 * The `kind` is what lets a target know which numbers are its own: a revenue
 * target belongs to Sales, a delivery target to Operations. A studio with a
 * fourth team calls it "other" and sets its targets by hand.
 */

export const TEAM_KINDS = ["hr", "sales", "operations", "accounts", "marketing", "other"];

const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "A name is required"], trim: true },
    kind: { type: String, enum: TEAM_KINDS, default: "operations" },

    description: { type: String, trim: true, default: "" },

    /**
     * One person answers for this team's numbers.
     *
     * Singular on purpose. A team with two managers is a team where a missed
     * target is somebody else's fault, and the whole point of the field is
     * that there is a name against the number.
     */
    manager: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    /** Who runs the day to day. A small team may have none, and that is fine. */
    teamLeaders: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    active: { type: Boolean, default: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

/** Everybody on it, manager included, with no duplicates. */
teamSchema.methods.everyone = function everyone() {
  const ids = [
    this.manager,
    ...(this.teamLeaders || []),
    ...(this.members || []),
  ]
    .filter(Boolean)
    .map((entry) => String(entry._id || entry));

  return [...new Set(ids)];
};

teamSchema.index({ kind: 1, active: 1 });
teamSchema.index({ manager: 1 });
teamSchema.index({ teamLeaders: 1 });
teamSchema.index({ members: 1 });

const Team = mongoose.model("Team", teamSchema);

export default Team;
