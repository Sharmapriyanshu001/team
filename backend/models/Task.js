import mongoose from "mongoose";

export const TASK_STATUS = ["pending", "in_progress", "review", "completed"];

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, "Title is required"], trim: true },
    description: { type: String, trim: true, default: "" },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    /**
     * The team this belongs to, for work that is not attached to a project.
     *
     * Hiring somebody, chasing a payment and writing a proposal are all real
     * work with a real owner and a real due date, and none of them belong to a
     * client project — which is why every task used to need one and HR and
     * Sales therefore kept their work somewhere else.
     */
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: TASK_STATUS, default: "pending" },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    /**
     * When the work is meant to start, beside when it is meant to end.
     *
     * A due date on its own says when somebody is late; it does not say when
     * they were supposed to pick the job up. Two tasks due Friday, one of them
     * a week's work, read identically without this — which is how a person
     * ends up with a month of work all starting on the same Monday.
     *
     * Optional, like dueDate. Work that starts whenever there is room is real
     * work, and inventing a date for it would make every schedule report a
     * fiction.
     */
    startDate: { type: Date },
    dueDate: { type: Date },
    completedAt: { type: Date },

    /**
     * How far along, as the person doing it says.
     *
     * Status alone is four buckets, and "in progress" covers both the first
     * hour and the last. A client asking "how far is my project" is asking
     * this question, and the honest answer has to come from the people doing
     * the work rather than being inferred from how many tasks are ticked off.
     *
     * Kept beside status rather than derived from it: they answer different
     * questions and can legitimately disagree — work can be 90% done and
     * still sitting in review.
     */
    progress: { type: Number, min: 0, max: 100, default: 0 },

    /**
     * Money attached to finishing this particular job.
     *
     * Separate from the incentive scheme in utils/incentive.js, which scores a
     * whole month in points against deadlines. This is the other thing a
     * company actually does: "there is ₹2,000 on this one if it lands." Both
     * exist because they are different promises, and folding one into the
     * other would mean neither could be explained.
     *
     * Zero, and the task simply carries no bonus.
     */
    bonus: { type: Number, min: 0, default: 0 },

    /**
     * When the bonus was actually earned, or empty if it has not been.
     *
     * A date rather than a flag, because the question payroll asks is "which
     * month does this fall in" and a boolean cannot answer it. Set and cleared
     * by the hook below rather than by any handler — see the note there.
     */
    bonusAwardedAt: { type: Date },
    // False from the moment work lands on someone until they open their task
    // list — that is what puts the red dot on their sidebar. Existing tasks
    // default to true so nothing lights up retrospectively.
    seenByAssignee: { type: Boolean, default: true },
    // Filled in when a task is reviewed
    reviewNote: { type: String, trim: true, default: "" },
    reviewRating: { type: Number, min: 0, max: 5, default: 0 },
  },
  { timestamps: true }
);

// Keep completedAt in sync with the status so reports stay accurate.
// Declared with no arguments so Mongoose treats it as a promise-style hook —
// `next` is no longer passed to document middleware.
taskSchema.pre("save", function () {
  if (this.isModified("status")) {
    const done = this.status === "completed";
    this.completedAt = done ? new Date() : undefined;

    /**
     * Finishing the work is what earns the bonus, and being sent back is what
     * un-earns it.
     *
     * Here rather than in the handlers because there are four call sites that
     * can move a task's status — a leader's review, an employee's own update,
     * the admin panel, the sales task screen — and a bonus that is recorded by
     * three of them and forgotten by the fourth is worse than no bonus field
     * at all. The status is the single fact this depends on, so the rule lives
     * where the status is written.
     *
     * Re-completing after a rework earns it again, with the later date. The
     * bonus is for the accepted work, not for the first attempt at it.
     */
    if (this.bonus > 0) {
      this.bonusAwardedAt = done ? this.completedAt : undefined;
    }

    /**
     * Finished work is finished. An assignee who marks a task done at 60% has
     * said the job is over, and leaving the old figure on it would put a
     * project's progress permanently short of what was actually delivered.
     *
     * The reverse is deliberately not done: a task sent back to rework keeps
     * the progress it had, because the work up to that point still exists.
     */
    if (done) this.progress = 100;
  }

  /**
   * A bonus added to a task that is already finished is earned on the spot —
   * otherwise a manager who forgot to put the amount on before it landed has
   * to send perfectly good work back to rework to pay for it.
   */
  if (this.isModified("bonus") && this.status === "completed") {
    this.bonusAwardedAt = this.bonus > 0 ? this.completedAt || new Date() : undefined;
  }
});

/**
 * The project's headline percentage follows its tasks.
 *
 * A post-save hook rather than a call in each handler, for the same reason the
 * pre-save above is one: a leader's edit, an employee's progress report, an
 * admin's inline change and a review approval can all move a task, and a
 * roll-up performed by three of them is a number that disagrees with the
 * fourth. The rule lives where the task is written.
 *
 * Fire and forget, and it swallows its own failures. Nothing about a project's
 * summary figure is worth failing somebody's task update over — the next save
 * recomputes it from scratch anyway, because it is derived rather than
 * incremented.
 */
taskSchema.post("save", function (doc) {
  if (!doc.project) return;

  import("../utils/projectProgress.js")
    .then(({ refreshProjectProgress }) => refreshProjectProgress(doc.project))
    .catch((err) => console.error("project progress roll-up:", err.message));
});

// Powers the "you have new work" dot, which every panel load asks for.
taskSchema.index({ assignedTo: 1, seenByAssignee: 1 });

// "What has this person earned, and when" — the bonus report's only question.
taskSchema.index({ assignedTo: 1, bonusAwardedAt: -1 });

const Task = mongoose.model("Task", taskSchema);

export default Task;
