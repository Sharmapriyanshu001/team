import mongoose from "mongoose";

/**
 * Keep a project's headline percentage in step with the work underneath it.
 *
 * `Project.progress` was a number somebody typed. Every screen in the app
 * reads it — the client's progress page, the admin board, the sales handover
 * list — and none of them could tell whether it had been touched since the
 * project started. A project 90% finished and a project last updated at 90%
 * three months ago rendered identically.
 *
 * WHY IT IS AVERAGED PER TASK RATHER THAN COUNTED
 *
 * Counting completed tasks gives a number that only ever moves in jumps, and
 * sits at 0% for as long as the first task takes. Averaging each task's own
 * progress means a week of work on one big task shows as a week of work. The
 * two agree wherever tasks are small, and where they disagree the average is
 * the one a client would recognise.
 *
 * Unweighted on purpose. Weighting by estimated size would be more accurate
 * and would require every task to carry an estimate — and a weighting built on
 * estimates half the tasks do not have is less honest than a plain average,
 * not more.
 *
 * WHAT IT WILL NOT DO
 *
 * It never touches a project with no tasks. A project in planning is at
 * whatever the manager set it to, and resetting that to zero because nobody
 * has broken the work down yet would overwrite a deliberate statement with an
 * accident of scheduling.
 */
export const refreshProjectProgress = async (projectId) => {
  if (!projectId) return null;

  const Task = mongoose.model("Task");
  const Project = mongoose.model("Project");

  const [row] = await Task.aggregate([
    { $match: { project: new mongoose.Types.ObjectId(String(projectId)) } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        /**
         * A completed task counts as 100 whatever its progress field says.
         * The two are kept in step by Task.js's own hook, but a row written
         * before that hook existed can still be completed at 0 — and reading
         * such a project as unstarted would be the one wrong answer that
         * matters here.
         */
        sum: {
          $sum: {
            $cond: [{ $eq: ["$status", "completed"] }, 100, { $ifNull: ["$progress", 0] }],
          },
        },
        completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
      },
    },
  ]);

  if (!row?.total) return null;

  const progress = Math.min(100, Math.max(0, Math.round(row.sum / row.total)));

  /**
   * Written only when it actually changed. Without the guard every task save
   * would touch the project document, which moves its `updatedAt` and makes
   * "recently changed projects" meaningless.
   */
  await Project.updateOne(
    { _id: projectId, progress: { $ne: progress } },
    { $set: { progress } }
  );

  return { progress, tasks: row.total, completed: row.completed };
};

export default refreshProjectProgress;
