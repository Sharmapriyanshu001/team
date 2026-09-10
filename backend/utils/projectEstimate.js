/**
 * When a project will actually be finished, from the work rather than the plan.
 *
 * `endDate` is a promise somebody made at the start. This is the other number,
 * and the client is asking for this one: at the rate the tasks are actually
 * being closed, when does the remaining work run out?
 *
 * Computed rather than stored, for the same reason the incentive scheme is —
 * a stored estimate is a number that was true once and is now quietly wrong,
 * and nobody ever goes back to reconcile it. Read from the tasks, it cannot
 * disagree with them.
 *
 * WHAT IT REFUSES TO SAY
 *
 * The honest answer is often "not yet". A project where nothing has been
 * finished has no rate to extrapolate from, and inventing one — falling back
 * to the planned date, or assuming a task a day — produces a confident date
 * built on nothing, which is worse than a blank. So `estimatedDate` comes back
 * null in those cases and `basis` says why, and every screen shows the reason
 * rather than a dash.
 */

const DAY = 86400000;

const startOfDay = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * @param {object} project  needs startDate, endDate, createdAt, status
 * @param {object} tasks    { total, completed }
 * @param {Date}   now
 */
export const estimateCompletion = (project, tasks = {}, now = new Date()) => {
  const total = Number(tasks.total) || 0;
  const completed = Number(tasks.completed) || 0;
  const remaining = Math.max(0, total - completed);

  const planned = project?.endDate ? new Date(project.endDate) : null;
  const daysLeftPlanned = planned ? Math.ceil((planned - now) / DAY) : null;

  const base = {
    plannedDate: planned,
    daysLeftPlanned,
    overdue:
      daysLeftPlanned !== null && daysLeftPlanned < 0 && project?.status !== "completed",
    tasksTotal: total,
    tasksCompleted: completed,
    tasksRemaining: remaining,
    taskProgress: total ? Math.round((completed / total) * 100) : 0,
    estimatedDate: null,
    daysNeeded: null,
    basis: "",
  };

  if (project?.status === "completed") {
    return { ...base, estimatedDate: null, basis: "This project is finished." };
  }

  if (!total) {
    return { ...base, basis: "No tasks have been planned yet, so there is nothing to measure." };
  }

  if (remaining === 0) {
    return {
      ...base,
      estimatedDate: null,
      basis: "Every task is done — waiting on sign-off rather than on work.",
    };
  }

  /**
   * Measured from when work actually began, not from when the record was
   * opened. A project created in January and started in March has not been
   * running slowly for two months; it was not running at all.
   */
  const started = project?.startDate || project?.createdAt;
  if (!started) {
    return { ...base, basis: "No start date, so there is no period to measure the rate over." };
  }

  const elapsedDays = Math.max(1, Math.round((startOfDay(now) - startOfDay(started)) / DAY));

  if (!completed) {
    return {
      ...base,
      basis: `Nothing has been completed in ${elapsedDays} day${
        elapsedDays === 1 ? "" : "s"
      }, so there is no rate to project from yet.`,
    };
  }

  const perDay = completed / elapsedDays;
  const daysNeeded = Math.ceil(remaining / perDay);

  const estimatedDate = new Date(startOfDay(now).getTime() + daysNeeded * DAY);

  return {
    ...base,
    estimatedDate,
    daysNeeded,
    /**
     * The working is returned with the answer. A date somebody cannot check is
     * a date they will either over-trust or ignore, and the whole figure rests
     * on two numbers they can verify against their own task list.
     */
    basis: `${completed} of ${total} task${total === 1 ? "" : "s"} finished in ${elapsedDays} day${
      elapsedDays === 1 ? "" : "s"
    } — about ${remaining} left at that rate.`,
    /** True when the honest estimate lands after the date that was promised. */
    behindPlan: planned ? estimatedDate > planned : false,
  };
};

export default estimateCompletion;
