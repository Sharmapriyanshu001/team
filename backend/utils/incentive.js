import IncentiveAdjustment from "../models/IncentiveAdjustment.js";
import IncentiveRule from "../models/IncentiveRule.js";
import Task from "../models/Task.js";

/**
 * The incentive scheme: what an employee's month is worth.
 *
 * Points are COMPUTED FROM THE TASKS, not banked when work is done. That is
 * the central decision here and it is worth being explicit about, because the
 * obvious alternative — writing a ledger row each time a task is completed —
 * is what most systems do and it goes wrong in a particular way.
 *
 * Banking points means the score and the work can disagree. A task reopened
 * after being marked done, a due date corrected, a task reassigned to the
 * person who actually did it — each of those leaves a stale row behind that
 * nobody will ever reconcile, and the person sees a number they cannot check
 * against anything. Computing means the score is always exactly what the task
 * list says, and "why is my score that" is answerable by pointing at the
 * tasks.
 *
 * It also means there is nothing to hook into. Task.js already stamps
 * `completedAt` from the status in a pre-save hook, so every completion is
 * dated wherever it happens — the leader's review screen, the admin panel, a
 * future route nobody has written yet — and this reads all of them without a
 * single call site needing to know the scheme exists.
 *
 * The cost is that changing the rules re-scores history. That is documented on
 * IncentiveRule and is the right trade for a scheme this size.
 *
 * ONE RULE THAT MATTERS MORE THAN THE ARITHMETIC: a task with no due date is
 * never counted as late or overdue. Nobody agreed a deadline, so there is
 * nothing to miss, and penalising somebody for a date that was never set is
 * how a scheme loses the room in its first week.
 */

const DAY = 86400000;

/** "2026-09" → the month it names, in local time. */
export const periodRange = (period) => {
  const [year, month] = String(period || "").split("-").map(Number);
  if (!year || !month) {
    const now = new Date();
    return periodRange(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  }
  return {
    from: new Date(year, month - 1, 1),
    to: new Date(year, month, 0, 23, 59, 59, 999),
  };
};

export const currentPeriod = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

/** Whole days late, rounded down. Same day is never late. */
const daysLate = (completedAt, dueDate) => {
  const done = new Date(completedAt);
  const due = new Date(dueDate);
  done.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((done - due) / DAY));
};

/**
 * Score one task against the rules.
 *
 * Returns the points and, just as importantly, a line of plain English saying
 * why. Every number this scheme produces has to be explainable to the person
 * it is about, and the explanation is built here rather than reconstructed by
 * whichever screen is displaying it.
 *
 * The outcome is also returned as fields — `onTime` and `lateDays` — and those
 * are what the counting above works from. The prose is for people. It used to
 * be for both: the monthly tallies were produced by running /on time/ over
 * this sentence, so the "on time" figure on three screens and in the payroll
 * summary depended on the exact wording of an explanation, and rephrasing it
 * would have moved the numbers without touching a single rule.
 *
 * `onTime` is deliberately three-valued. True met an agreed date, false missed
 * one, and null means no date was ever set — which is not the same as being
 * punctual and must not be counted as if it were.
 */
export const scoreTask = (task, rule, now = new Date()) => {
  const hasDue = Boolean(task.dueDate);

  if (task.status === "completed") {
    let points = rule.completedPoints;
    const parts = [`completed (+${rule.completedPoints})`];

    let onTime = null;
    let lateDays = 0;

    if (hasDue) {
      lateDays = daysLate(task.completedAt || task.updatedAt, task.dueDate);
      onTime = lateDays === 0;

      if (onTime) {
        points += rule.onTimeBonus;
        parts.push(`on time (+${rule.onTimeBonus})`);
      } else {
        const penalty = Math.min(
          rule.latePenalty + lateDays * rule.latePerDay,
          rule.lateMaxPenalty
        );
        points -= penalty;
        parts.push(`${lateDays} day${lateDays === 1 ? "" : "s"} late (−${penalty})`);
      }
    } else {
      parts.push("no due date set, so not judged on timing");
    }

    /**
     * A rating has to have actually been given. reviewRating defaults to 0 on
     * every task, so testing only against the threshold handed the quality
     * bonus to every unreviewed task the moment somebody set the minimum to
     * zero — which reads as "quality is not being judged this month", not as
     * "pay everybody the quality bonus".
     */
    const rated = Number(task.reviewRating) || 0;
    if (rule.qualityBonus && rated > 0 && rated >= rule.qualityMinRating) {
      points += rule.qualityBonus;
      parts.push(`rated ${rated}/5 (+${rule.qualityBonus})`);
    }

    return { points, outcome: "completed", onTime, lateDays, why: parts.join(" · ") };
  }

  /**
   * Not finished. Only counts against somebody if a date was agreed and has
   * passed — an open task with time left on it is simply work in progress and
   * scores nothing either way.
   */
  if (hasDue && new Date(task.dueDate) < now) {
    const lateDays = daysLate(now, task.dueDate);
    return {
      points: -rule.overduePenalty,
      outcome: "overdue",
      onTime: false,
      lateDays,
      why: `still open, ${lateDays} day(s) past the due date (−${rule.overduePenalty})`,
    };
  }

  return {
    points: 0,
    outcome: "open",
    onTime: null,
    lateDays: 0,
    why: "in progress, nothing due yet",
  };
};

/**
 * One person's month.
 *
 * Which tasks belong to a month is the fiddly part: a task completed in
 * September counts in September, and a task still open counts in the month it
 * was DUE. Without that second rule an overdue task would either follow the
 * person forever or vanish from the month they missed.
 */
export const scoreEmployee = async (employeeId, period, rule) => {
  const { from, to } = periodRange(period);
  const now = new Date();

  const tasks = await Task.find({
    assignedTo: employeeId,
    $or: [
      { status: "completed", completedAt: { $gte: from, $lte: to } },
      { status: { $ne: "completed" }, dueDate: { $gte: from, $lte: to } },
    ],
  })
    .select("title status dueDate completedAt reviewRating project")
    .populate("project", "name")
    .sort({ dueDate: 1 });

  const lines = tasks.map((task) => {
    const scored = scoreTask(task, rule, now);
    return {
      _id: task._id,
      title: task.title,
      project: task.project?.name || "",
      status: task.status,
      dueDate: task.dueDate || null,
      completedAt: task.completedAt || null,
      ...scored,
    };
  });

  /**
   * Delivered work with no agreed date is counted on its own rather than
   * folded into "on time".
   *
   * It used to land in the on-time column, which made the figure say something
   * it could not support: a month where nobody set a due date reported 100%
   * on time. That is the one number this scheme exists to report, so it now
   * counts only tasks that actually met a date somebody agreed. The delivered
   * work is still there, under a heading that says what it is.
   */
  const counts = {
    completedOnTime: 0,
    completedLate: 0,
    completedNoDate: 0,
    overdue: 0,
    open: 0,
  };

  lines.forEach((l) => {
    if (l.outcome === "completed") {
      if (l.onTime === true) counts.completedOnTime += 1;
      else if (l.onTime === false) counts.completedLate += 1;
      else counts.completedNoDate += 1;
    } else if (l.outcome === "overdue") counts.overdue += 1;
    else counts.open += 1;
  });

  /** Everything finished, however it was judged. */
  counts.completed = counts.completedOnTime + counts.completedLate + counts.completedNoDate;

  /**
   * Of the work that had a date to be judged against. Undated tasks are left
   * out of both halves rather than counted as successes, and a month with no
   * dated work reports null instead of a triumphant 100%.
   */
  const judged = counts.completedOnTime + counts.completedLate + counts.overdue;
  counts.onTimeRate = judged ? Math.round((counts.completedOnTime / judged) * 100) : null;

  const taskPoints = lines.reduce((sum, l) => sum + l.points, 0);

  const adjustments = await IncentiveAdjustment.find({ employee: employeeId, period })
    .populate("by", "name")
    .sort({ createdAt: -1 });

  const adjustmentPoints = adjustments.reduce((sum, a) => sum + a.points, 0);

  /**
   * Never below zero. A negative month is a conversation to have, not a debt
   * to carry into the next one — and a bonus cannot be less than nothing, so
   * the floor changes no payout while making the number readable.
   *
   * The raw figure is returned beside it, and whether the floor actually bit,
   * because of a trap that is otherwise very confusing: somebody sitting at
   * −2 who is awarded 7 points sees their total move from 0 to 5, not to 7.
   * That arithmetic is right — they were below zero — but with only the
   * floored number on screen it reads as the award having been shaved. The
   * screens say so explicitly rather than leaving anybody to work it out.
   */
  const raw = taskPoints + adjustmentPoints;
  const total = Math.max(0, raw);

  return {
    period,
    taskPoints,
    adjustmentPoints,
    raw,
    floored: raw < 0,
    total,
    counts,
    lines,
    adjustments: adjustments.map((a) => ({
      _id: a._id,
      points: a.points,
      reason: a.reason,
      by: a.by?.name || a.byName || "",
      at: a.createdAt,
    })),
    bonus: bonusFor(total, rule),
  };
};

/**
 * The highest slab this many points reaches, and how far the next one is.
 *
 * The distance to the next slab is the part people actually act on, so it is
 * returned rather than left for a screen to work out — and worked out here
 * once rather than in each of the three places that show it.
 */
export const bonusFor = (points, rule) => {
  const slabs = [...(rule.bonusSlabs || [])].sort((a, b) => a.minPoints - b.minPoints);

  let earned = { amount: 0, label: "", minPoints: 0 };
  let next = null;

  slabs.forEach((slab) => {
    if (points >= slab.minPoints) {
      earned = { amount: slab.amount, label: slab.label || "", minPoints: slab.minPoints };
    } else if (!next) {
      next = { amount: slab.amount, label: slab.label || "", minPoints: slab.minPoints };
    }
  });

  return {
    amount: earned.amount,
    label: earned.label,
    next: next ? { ...next, pointsAway: next.minPoints - points } : null,
  };
};

/** The live scheme, created with sensible defaults the first time it is asked for. */
export const activeRule = () => IncentiveRule.current();
