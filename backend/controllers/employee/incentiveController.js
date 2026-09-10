import { activeRule, currentPeriod, scoreEmployee } from "../../utils/incentive.js";

/**
 * What this month is worth to the person who earned it.
 *
 * Deliberately shows the working. A score somebody cannot check is a score
 * they will not trust, so every task that moved the number is listed with the
 * reason it did — including the ones that cost points. Hiding those would make
 * the total unexplainable, which is worse than the bad news.
 *
 * Read-only on purpose: an employee sees their own score and can do nothing to
 * it. Adjustments are HR's, and the task-derived part answers only to the
 * tasks themselves.
 */

// GET /api/employee/incentive?period=YYYY-MM
export const myIncentive = async (req, res) => {
  try {
    const period = String(req.query.period || currentPeriod());
    const rule = await activeRule();

    const score = await scoreEmployee(req.employee._id, period, rule);

    return res.status(200).json({
      ...score,
      /**
       * The scheme itself travels with the score. It is what makes the numbers
       * mean anything, and a person asking "why did that cost five points"
       * should not have to ask somebody.
       */
      rule: {
        name: rule.name,
        completedPoints: rule.completedPoints,
        onTimeBonus: rule.onTimeBonus,
        latePenalty: rule.latePenalty,
        latePerDay: rule.latePerDay,
        lateMaxPenalty: rule.lateMaxPenalty,
        overduePenalty: rule.overduePenalty,
        qualityMinRating: rule.qualityMinRating,
        qualityBonus: rule.qualityBonus,
        bonusSlabs: rule.bonusSlabs,
      },
    });
  } catch (err) {
    console.error("myIncentive error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/employee/incentive/history?months=6
 *
 * The last few months, so somebody can see whether they are improving rather
 * than only what today looks like.
 */
export const myIncentiveHistory = async (req, res) => {
  try {
    const months = Math.min(12, Math.max(1, Number(req.query.months) || 6));
    const rule = await activeRule();

    const now = new Date();
    const periods = [];
    for (let i = 0; i < months; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const scores = await Promise.all(
      periods.map((p) => scoreEmployee(req.employee._id, p, rule))
    );

    return res.status(200).json({
      items: scores
        .map((s) => ({
          period: s.period,
          total: s.total,
          bonus: s.bonus.amount,
          counts: s.counts,
        }))
        .reverse(),
    });
  } catch (err) {
    console.error("myIncentiveHistory error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
