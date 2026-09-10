import Attendance from "../models/Attendance.js";
import Leave from "../models/Leave.js";
import LeavePolicy from "../models/LeavePolicy.js";
import SalaryPayment from "../models/SalaryPayment.js";

/**
 * What somebody has earned, what they have been given, and what is left.
 *
 * Computed from the attendance sheet on every read rather than banked anywhere.
 * A stored total is only as right as the last time somebody remembered to
 * recalculate it, and attendance gets corrected all the time — a day marked
 * absent that turns out to have been leave, a half day entered as a full one.
 * Read from the sheet, the figure cannot disagree with the sheet.
 *
 * WHAT A DAY IS WORTH
 *
 *   present    a full day
 *   half_day   half of one
 *   leave      a full day IF the policy for that kind of leave is paid, and
 *              nothing if it is not — LeavePolicy.paid exists for exactly this
 *   absent     nothing
 *   unmarked   nothing, and not counted as absent either
 *
 * That last one matters. A month that is half-marked should not report that
 * somebody was absent for the rest of it; the days simply have not happened or
 * have not been entered, and the screen says how many were marked so the
 * figure can be read for what it is.
 */

const DAY_VALUE = { present: 1, half_day: 0.5, absent: 0, leave: 0 };

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

const monthRange = (year, month) => ({
  from: new Date(year, month - 1, 1),
  to: new Date(year, month, 0, 23, 59, 59, 999),
});

/**
 * Which dates in the window were covered by leave, and whether that leave was
 * paid.
 *
 * The attendance row says "leave" but not which kind, so the type comes from
 * the Leave record covering that date and the paid/unpaid answer from the
 * policy for that type. A leave with no matching policy is treated as paid —
 * the company approved the absence, and docking pay because nobody wrote the
 * policy down is the wrong way round.
 */
const paidLeaveDates = async (employeeId, from, to) => {
  const [leaves, policies] = await Promise.all([
    Leave.find({
      employee: employeeId,
      status: "approved",
      fromDate: { $lte: to },
      toDate: { $gte: from },
    }).select("type fromDate toDate"),
    LeavePolicy.find().select("type paid"),
  ]);

  const unpaidTypes = new Set(
    policies.filter((p) => p.paid === false).map((p) => p.type)
  );

  const paid = new Set();
  const unpaid = new Set();

  leaves.forEach((leave) => {
    const target = unpaidTypes.has(leave.type) ? unpaid : paid;

    const cursor = new Date(leave.fromDate);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(leave.toDate);

    while (cursor <= end) {
      target.add(cursor.toDateString());
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  return { paid, unpaid };
};

/**
 * One month, day by day.
 *
 * Returns the marked days with what each was worth, so the screen can show the
 * working rather than a total somebody has to trust. That is the whole point:
 * "why is it 4,200" is answerable by pointing at fourteen rows.
 */
export const monthSalary = async (employee, year, month) => {
  const rate = Number(employee?.pay?.dailyRate) || 0;
  const { from, to } = monthRange(year, month);

  const [marks, leaveDates] = await Promise.all([
    Attendance.find({ employee: employee._id, date: { $gte: from, $lte: to } })
      .select("date status note")
      .sort({ date: 1 }),
    paidLeaveDates(employee._id, from, to),
  ]);

  const counts = { present: 0, absent: 0, half_day: 0, leave: 0 };
  let payableDays = 0;

  const days = marks.map((mark) => {
    const status = mark.status;
    counts[status] = (counts[status] || 0) + 1;

    /**
     * A leave day is worth a full day unless the policy behind it is unpaid.
     * Checked against the dates the leave actually covers rather than against
     * the attendance row, which only knows that somebody was away.
     */
    let value = DAY_VALUE[status] ?? 0;
    let paidLeave = null;

    if (status === "leave") {
      const key = new Date(mark.date).toDateString();
      paidLeave = !leaveDates.unpaid.has(key);
      value = paidLeave ? 1 : 0;
    }

    payableDays = round(payableDays + value);

    return {
      date: mark.date,
      status,
      note: mark.note || "",
      /** What this one day added. */
      value,
      amount: round(value * rate),
      paidLeave,
    };
  });

  const earned = round(payableDays * rate);

  return {
    year,
    month,
    dailyRate: rate,
    marked: marks.length,
    counts,
    payableDays,
    earned,
    days,
  };
};

/**
 * The whole picture for one person: this month, everything before it, and
 * what is still owed.
 *
 * `asOf` exists so a test can ask about a fixed month rather than whatever
 * today happens to be.
 */
export const salarySummary = async (employee, { year, month } = {}) => {
  const now = new Date();
  const y = Number(year) || now.getFullYear();
  const m = Number(month) || now.getMonth() + 1;

  const rate = Number(employee?.pay?.dailyRate) || 0;
  const { from, to } = monthRange(y, m);

  const [thisMonth, payments, paidThisMonthRows, paidEverRows, allMarks, leaveEver] =
    await Promise.all([
      monthSalary(employee, y, m),
      SalaryPayment.find({ employee: employee._id })
        .select("amount paidOn mode reference note recordedByName")
        .sort({ paidOn: -1 })
        .limit(100),
      SalaryPayment.aggregate([
        { $match: { employee: employee._id, paidOn: { $gte: from, $lte: to } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      SalaryPayment.aggregate([
        { $match: { employee: employee._id } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      /**
       * Every attendance mark ever, for the lifetime figure. Counted rather
       * than listed — the day-by-day breakdown is only ever shown for one
       * month, and returning a year of rows to add them up would be a lot of
       * data for one number.
       */
      Attendance.aggregate([
        { $match: { employee: employee._id } },
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ]),
      Leave.find({ employee: employee._id, status: "approved" }).select("type fromDate toDate"),
    ]);

  const paidThisMonth = round(paidThisMonthRows[0]?.total || 0);
  const paidEver = round(paidEverRows[0]?.total || 0);

  /**
   * Lifetime earnings.
   *
   * Leave is counted as payable here rather than checked policy by policy —
   * doing that properly across every month would mean walking every leave
   * record against every day, and this figure exists to answer "roughly what
   * have we paid this person for" rather than to settle a dispute. The month
   * view, which is what a dispute is actually about, does check.
   */
  const lifetime = allMarks.reduce(
    (acc, row) => {
      acc.counts[row._id] = row.n;
      acc.days = round(acc.days + (DAY_VALUE[row._id] ?? 0) * row.n);
      if (row._id === "leave") acc.days = round(acc.days + row.n);
      return acc;
    },
    { days: 0, counts: {} }
  );

  const earnedEver = round(lifetime.days * rate);

  return {
    dailyRate: rate,
    /** Nobody has set a rate, so every figure below would be zero and a lie. */
    rateSet: rate > 0,

    month: {
      year: y,
      month: m,
      ...thisMonth,
      paid: paidThisMonth,
      due: round(thisMonth.earned - paidThisMonth),
    },

    lifetime: {
      payableDays: lifetime.days,
      counts: lifetime.counts,
      earned: earnedEver,
      paid: paidEver,
      /**
       * What is still owed overall. Can legitimately be negative — an advance
       * is money paid before it was earned — and is reported as it is rather
       * than floored, because "we are ₹2,000 ahead" is a real and useful thing
       * for payroll to see.
       */
      due: round(earnedEver - paidEver),
    },

    payments,
    leaveCount: leaveEver.length,
  };
};

export default salarySummary;
