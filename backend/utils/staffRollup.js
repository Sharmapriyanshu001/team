import Task from "../models/Task.js";

/**
 * How one person's work adds up.
 *
 * The admin panel's profile drawer and the HR panel's are the same screen
 * reading the same numbers, so the counting lives here rather than in each
 * controller. Two copies of "how many of their tasks were late" is two answers
 * to a question that has one.
 */

export const countByStatus = (rows) =>
  rows.reduce((acc, row) => {
    acc[row._id] = row.count;
    return acc;
  }, {});

export const sumCounts = (counts) => Object.values(counts).reduce((sum, n) => sum + n, 0);

/** What a project card needs, and nothing heavier. */
export const projectFields = "name code status priority progress budget endDate";

export const projectRollup = (projects) => ({
  projects: projects.length,
  projectsActive: projects.filter((p) => p.status === "in_progress").length,
  projectsCompleted: projects.filter((p) => p.status === "completed").length,
  avgProgress: projects.length
    ? Math.round(projects.reduce((sum, p) => sum + (p.progress || 0), 0) / projects.length)
    : 0,
});

/**
 * Task counts across a set of projects, or for one person, split the way the
 * cards read them.
 */
export const taskRollup = async (match) => {
  const counts = countByStatus(
    await Task.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }])
  );

  /**
   * Late work, counted separately from open work.
   *
   * "Six pending" and "six pending, two of them late" are different answers to
   * the same question, and the second is the one somebody opening a person's
   * record is actually looking for.
   */
  const [overdue, onTime, lateDone] = await Promise.all([
    Task.countDocuments({
      ...match,
      status: { $ne: "completed" },
      dueDate: { $lt: new Date() },
    }),
    /**
     * Finished work, split by whether it landed on the day it was due.
     *
     * Tasks with no due date are in neither count. A task nobody put a date on
     * cannot be late, and counting it as on time would let a team with no
     * deadlines score better than one that sets them and mostly meets them.
     *
     * A completion date is required for the same reason and one more: in a
     * comparison, a missing date sorts below everything, so a task finished
     * before completedAt was recorded would silently count as on time and
     * flatter the number. Those are left out of both sides.
     */
    Task.countDocuments({
      ...match,
      status: "completed",
      dueDate: { $ne: null },
      completedAt: { $ne: null },
      $expr: { $lte: ["$completedAt", "$dueDate"] },
    }),
    Task.countDocuments({
      ...match,
      status: "completed",
      dueDate: { $ne: null },
      completedAt: { $ne: null },
      $expr: { $gt: ["$completedAt", "$dueDate"] },
    }),
  ]);

  const judged = onTime + lateDone;

  return {
    tasksTotal: sumCounts(counts),
    tasksCompleted: counts.completed || 0,
    tasksPending: (counts.pending || 0) + (counts.in_progress || 0),
    tasksInReview: counts.review || 0,
    tasksOverdue: overdue,
    tasksOnTime: onTime,
    tasksLate: lateDone,
    // Null rather than 100 when nothing has been judged: "no deadlines yet" is
    // not a perfect record, and a tile saying 100% would claim it is.
    onTimeRate: judged ? Math.round((onTime / judged) * 100) : null,
  };
};

export const monthStart = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

export const yearStart = () => new Date(new Date().getFullYear(), 0, 1);
