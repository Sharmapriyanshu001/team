import IncentiveAdjustment from "../../models/IncentiveAdjustment.js";
import IncentiveRule from "../../models/IncentiveRule.js";
import User from "../../models/User.js";

import { actorOf } from "../../utils/actor.js";
import { logActivity } from "../../utils/activity.js";
import { notifyUser } from "../../utils/notify.js";
import { activeRule, currentPeriod, scoreEmployee } from "../../utils/incentive.js";

/**
 * The incentive scheme, from HR's side: everybody's month, the adjustments
 * only a person can make, and the rules themselves.
 *
 * HR owns this because HR owns the payroll it feeds. The scoring is the same
 * engine the employee's own screen uses — one definition of what a point is,
 * so the number HR reads and the number the employee reads cannot differ.
 */

/* ------------------------------------------------------------- everybody */

/**
 * GET /api/hr/incentives?period=YYYY-MM
 *
 * The whole staff's month, ranked. This is the screen a bonus run is built
 * from, so it returns the payout beside the points rather than making somebody
 * cross-reference the ladder by hand.
 */
export const listIncentives = async (req, res) => {
  try {
    const period = String(req.query.period || currentPeriod());
    const rule = await activeRule();

    /**
     * Only the roles that carry tasks. Including administrators and department
     * accounts would put a row of zeros against everybody who does not work
     * from a task board, which makes the table longer and says nothing.
     */
    const staff = await User.find({
      role: { $in: ["employee", "operations_manager"] },
      status: "active",
    })
      .select("name email designation department role")
      .sort({ name: 1 });

    const scored = await Promise.all(
      staff.map(async (person) => {
        const score = await scoreEmployee(person._id, period, rule);
        return {
          employee: {
            _id: person._id,
            name: person.name,
            email: person.email,
            designation: person.designation || "",
            department: person.department || "",
            role: person.role,
          },
          taskPoints: score.taskPoints,
          adjustmentPoints: score.adjustmentPoints,
          /**
           * The unfloored figure travels with the row.
           *
           * A month never goes below zero, so somebody on −8 shows a total of
           * 0 — and the table used to print "from tasks −8, points 0" with
           * nothing to say why, which reads as a bug in the arithmetic. The
           * detail modal explained it; the list it was read from did not.
           */
          raw: score.raw,
          floored: score.floored,
          total: score.total,
          counts: score.counts,
          bonus: score.bonus,
        };
      })
    );

    scored.sort((a, b) => b.total - a.total);

    const totals = scored.reduce(
      (acc, row) => {
        acc.people += 1;
        acc.points += row.total;
        acc.bonus += row.bonus.amount;
        acc.onTime += row.counts.completedOnTime;
        acc.late += row.counts.completedLate;
        acc.noDate += row.counts.completedNoDate;
        acc.overdue += row.counts.overdue;
        // How many people the bonus actually reached, which is not the same
        // question as what it costs — a large pot shared by two is a different
        // month from the same pot shared by twelve.
        if (row.bonus.amount > 0) acc.earning += 1;
        return acc;
      },
      { people: 0, points: 0, bonus: 0, onTime: 0, late: 0, noDate: 0, overdue: 0, earning: 0 }
    );

    /** Of the work that had a date to be judged against. See utils/incentive.js. */
    const judged = totals.onTime + totals.late + totals.overdue;
    totals.onTimeRate = judged ? Math.round((totals.onTime / judged) * 100) : null;

    /**
     * The bonus run, on its own.
     *
     * The ranked table answers "how did everybody do"; this answers "who is
     * being paid, and how much" — which is the question the month actually
     * ends on, and the one somebody was previously left to work out by
     * reading down a column of mostly zeros.
     */
    const earners = scored
      .filter((row) => row.bonus.amount > 0)
      .map((row) => ({
        employee: row.employee,
        total: row.total,
        amount: row.bonus.amount,
        label: row.bonus.label,
      }))
      .sort((a, b) => b.amount - a.amount || b.total - a.total);

    return res.status(200).json({ period, items: scored, earners, totals, rule });
  } catch (err) {
    console.error("listIncentives error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/hr/incentives/:employeeId?period=YYYY-MM
 *
 * One person's month with every task that moved the number, which is what
 * somebody needs open when the person is standing in front of them asking.
 */
export const employeeIncentive = async (req, res) => {
  try {
    const period = String(req.query.period || currentPeriod());
    const rule = await activeRule();

    const person = await User.findById(req.params.employeeId).select(
      "name email designation department role status"
    );
    if (!person) return res.status(404).json({ message: "That person was not found" });

    const score = await scoreEmployee(person._id, period, rule);

    return res.status(200).json({
      employee: {
        _id: person._id,
        name: person.name,
        email: person.email,
        designation: person.designation || "",
        department: person.department || "",
        role: person.role,
        status: person.status,
      },
      ...score,
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That person was not found" });
    }
    console.error("employeeIncentive error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------- adjustments */

/**
 * POST /api/hr/incentives/adjust
 *
 * Points a person decided rather than the rules worked out. A reason is
 * required by the model, not by kindness: an unexplained deduction is the
 * fastest way to make a scheme resented, and the person it is about can see
 * this row on their own screen.
 *
 * Which is also why they are told. Finding out about a deduction at payslip
 * time is worse than being told the day it happened.
 */
export const addAdjustment = async (req, res) => {
  try {
    const period = String(req.body.period || currentPeriod());
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ message: "A period looks like 2026-09" });
    }

    const points = Number(req.body.points);
    if (!points || Number.isNaN(points)) {
      return res.status(400).json({ message: "Say how many points, up or down" });
    }

    const reason = String(req.body.reason || "").trim();
    if (!reason) return res.status(400).json({ message: "Give a reason" });

    const person = await User.findById(req.body.employee).select("name");
    if (!person) return res.status(400).json({ message: "Choose who this is for" });

    const me = actorOf(req);
    const adjustment = await IncentiveAdjustment.create({
      employee: person._id,
      period,
      points,
      reason,
      by: me?._id,
      byName: me?.name || "",
    });

    logActivity(req, {
      action: "created",
      entity: "Incentive",
      entityId: adjustment._id,
      message: `${points > 0 ? "+" : ""}${points} incentive points for ${person.name} (${period}) — ${reason}`,
    });

    notifyUser(person._id, {
      type: "general",
      title:
        points > 0
          ? `You were awarded ${points} incentive points`
          : `${Math.abs(points)} incentive points were deducted`,
      message: `${period} · ${reason}`,
      link: "/employee/incentive",
    });

    return res.status(201).json({ message: "Adjustment recorded", item: adjustment });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("addAdjustment error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * DELETE /api/hr/incentives/adjust/:id
 *
 * Removing one that was entered by mistake. The employee is told, because a
 * silently vanishing award is worse than never having had it.
 */
export const removeAdjustment = async (req, res) => {
  try {
    const adjustment = await IncentiveAdjustment.findById(req.params.id).populate(
      "employee",
      "name"
    );
    if (!adjustment) return res.status(404).json({ message: "That adjustment was not found" });

    const employeeId = adjustment.employee?._id;
    const { points, period, reason } = adjustment;

    await adjustment.deleteOne();

    logActivity(req, {
      action: "deleted",
      entity: "Incentive",
      entityId: req.params.id,
      message: `Incentive adjustment removed (${period}) — ${reason}`,
    });

    if (employeeId) {
      notifyUser(employeeId, {
        type: "general",
        title: "An incentive adjustment was removed",
        message: `${period} · ${points > 0 ? "+" : ""}${points} points — ${reason}`,
        link: "/employee/incentive",
      });
    }

    return res.status(200).json({ message: "Adjustment removed" });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That adjustment was not found" });
    }
    console.error("removeAdjustment error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------------- rules */

// GET /api/hr/incentive-rules
export const getRules = async (req, res) => {
  try {
    return res.status(200).json({ item: await activeRule() });
  } catch (err) {
    console.error("getRules error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * PUT /api/hr/incentive-rules
 *
 * Changing the scheme re-scores every month, because points are computed from
 * the tasks rather than banked — see utils/incentive.js for why that trade was
 * made. The response says so plainly rather than leaving somebody to discover
 * that last month's figures moved.
 */
export const updateRules = async (req, res) => {
  try {
    const rule = await activeRule();

    const numbers = [
      "completedPoints",
      "onTimeBonus",
      "latePenalty",
      "latePerDay",
      "lateMaxPenalty",
      "overduePenalty",
      "qualityMinRating",
      "qualityBonus",
    ];

    for (const field of numbers) {
      if (req.body[field] === undefined) continue;
      const value = Number(req.body[field]);
      if (Number.isNaN(value) || value < 0) {
        return res.status(400).json({ message: `${field} must be zero or more` });
      }
      rule[field] = value;
    }

    if (rule.qualityMinRating > 5) {
      return res.status(400).json({ message: "A rating is out of 5" });
    }

    if (req.body.name !== undefined) rule.name = String(req.body.name).trim();
    if (req.body.notes !== undefined) rule.notes = String(req.body.notes).trim();

    if (Array.isArray(req.body.bonusSlabs)) {
      const slabs = req.body.bonusSlabs
        .map((s) => ({
          minPoints: Number(s.minPoints) || 0,
          amount: Number(s.amount) || 0,
          label: String(s.label || "").trim(),
        }))
        .filter((s) => s.minPoints >= 0 && s.amount >= 0)
        .sort((a, b) => a.minPoints - b.minPoints);

      /**
       * Two slabs at the same threshold make the ladder ambiguous — which
       * amount applies is then whichever happened to sort first, which is not
       * a thing anybody should have to reason about at payroll time.
       */
      const thresholds = new Set(slabs.map((s) => s.minPoints));
      if (thresholds.size !== slabs.length) {
        return res.status(400).json({ message: "Two bonus steps cannot start at the same points" });
      }

      rule.bonusSlabs = slabs;
    }

    const me = actorOf(req);
    rule.updatedBy = me?._id;
    rule.updatedByName = me?.name || "";
    await rule.save();

    logActivity(req, {
      action: "updated",
      entity: "Incentive",
      entityId: rule._id,
      message: "Incentive scheme updated",
    });

    return res.status(200).json({
      message:
        "Scheme updated. Points are worked out from the tasks, so past months are scored on the new rules too.",
      item: rule,
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("updateRules error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export { IncentiveRule };
