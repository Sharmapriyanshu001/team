import SalaryPayment, { PAY_MODES } from "../models/SalaryPayment.js";
import User, { DEPARTMENT_ROLES } from "../models/User.js";

import { actorOf } from "../utils/actor.js";
import { logActivity } from "../utils/activity.js";
import { notifyUser } from "../utils/notify.js";
import { salarySummary } from "../utils/salary.js";

/**
 * Wages: what a day is worth, what has been earned, and what has been handed
 * over.
 *
 * Reachable from the admin panel and the HR panel and nowhere else. Payroll is
 * HR's job — they run the exits and the incentive scheme already — and an
 * administrator needs it for the same reason they need everything else. It is
 * not mounted on the operations manager's router or the employee's: a manager
 * knowing what their team is paid changes a working relationship, and that is
 * a decision for the company rather than a side effect of a route.
 *
 * WHAT IS STORED AND WHAT IS NOT
 *
 * The daily rate is stored on the person. Every payment is stored as its own
 * row. Nothing else is — what somebody has EARNED is computed from the
 * attendance sheet every time it is asked for, so correcting a day corrects
 * the wage bill, which is the only arrangement that cannot quietly go wrong.
 * See utils/salary.js.
 */

/**
 * The roles that draw a wage through this app.
 *
 * The same list hrController works from — everybody on the payroll, which is
 * the delivery side plus the department accounts. Administrators are left out
 * deliberately: whatever an owner pays themselves is not run through the
 * attendance sheet.
 */
const PAID_ROLES = ["manager", "operations_manager", "employee", ...DEPARTMENT_ROLES];

const findStaff = (id) =>
  User.findOne({ _id: id, role: { $in: PAID_ROLES } }).select(
    "name email role designation department pay status"
  );

/* ---------------------------------------------------------------- read */

/**
 * GET .../staff/:id/salary?year=&month=
 *
 * The whole picture: this month day by day, the lifetime totals, and every
 * payment. One request, because the screen shows them together and three
 * would be three chances to render half a page.
 */
export const getSalary = async (req, res) => {
  try {
    const employee = await findStaff(req.params.id);
    if (!employee) return res.status(404).json({ message: "That person was not found" });

    const summary = await salarySummary(employee, {
      year: req.query.year,
      month: req.query.month,
    });

    return res.status(200).json({
      employee: {
        _id: employee._id,
        name: employee.name,
        role: employee.role,
        designation: employee.designation || "",
      },
      ...summary,
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That person was not found" });
    }
    console.error("getSalary error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------- the rate */

/**
 * PUT .../staff/:id/salary/rate
 *
 * Changing the rate re-prices every month, past ones included, because
 * earnings are computed rather than banked. That is the right trade for a
 * company this size — the alternative is a dated rate history that somebody
 * has to maintain — but it is a real consequence, so the response says so
 * rather than leaving it to be discovered.
 */
export const setDailyRate = async (req, res) => {
  try {
    const employee = await findStaff(req.params.id);
    if (!employee) return res.status(404).json({ message: "That person was not found" });

    const rate = Number(req.body.dailyRate);
    if (Number.isNaN(rate) || rate < 0) {
      return res.status(400).json({ message: "A daily rate is zero or more" });
    }

    const was = employee.pay?.dailyRate || 0;

    employee.pay = { ...(employee.pay || {}), dailyRate: rate };
    await employee.save();

    logActivity(req, {
      action: "updated",
      entity: "Salary",
      entityId: employee._id,
      message: `${employee.name}'s daily rate set to ₹${rate} (was ₹${was})`,
    });

    return res.status(200).json({
      message:
        was && was !== rate
          ? "Rate updated. Earnings are worked out from the attendance sheet, so past months are re-priced at the new rate too."
          : "Daily rate saved",
      dailyRate: rate,
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That person was not found" });
    }
    console.error("setDailyRate error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------- a payment */

/**
 * POST .../staff/:id/salary/payments
 *
 * Recording money that has already left. Deliberately not "pay them" — this
 * app does not move money, and a row here is a note that a transfer happened
 * somewhere else. The reference field is what ties it back to the bank.
 */
export const addPayment = async (req, res) => {
  try {
    const employee = await findStaff(req.params.id);
    if (!employee) return res.status(404).json({ message: "That person was not found" });

    const amount = Number(req.body.amount);
    if (!amount || Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: "Say how much was paid" });
    }

    const me = actorOf(req);

    const payment = await SalaryPayment.create({
      employee: employee._id,
      amount,
      paidOn: req.body.paidOn || new Date(),
      mode: PAY_MODES.includes(req.body.mode) ? req.body.mode : "bank_transfer",
      reference: String(req.body.reference || "").trim(),
      note: String(req.body.note || "").trim(),
      recordedBy: me?._id,
      recordedByName: me?.name || "",
    });

    logActivity(req, {
      action: "created",
      entity: "Salary",
      entityId: payment._id,
      message: `₹${amount} salary paid to ${employee.name}`,
    });

    /**
     * They are told. Being paid is not a thing somebody should have to find
     * out from their bank statement, and it is the one notification in this
     * app that people actually want.
     */
    notifyUser(employee._id, {
      type: "general",
      title: `₹${amount.toLocaleString("en-IN")} salary paid`,
      message: `Recorded by ${me?.name || "the office"}${
        payment.reference ? ` · ref ${payment.reference}` : ""
      }`,
      link: "/employee/dashboard",
    });

    return res.status(201).json({ message: "Payment recorded", item: payment });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That person was not found" });
    }
    console.error("addPayment error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * DELETE .../staff/:id/salary/payments/:paymentId
 *
 * For a row entered by mistake. Logged and the person is told, because a
 * payment that quietly disappears from their record is worse than one that
 * was never entered.
 */
export const removePayment = async (req, res) => {
  try {
    const payment = await SalaryPayment.findOne({
      _id: req.params.paymentId,
      employee: req.params.id,
    });
    if (!payment) return res.status(404).json({ message: "That payment was not found" });

    const employee = await findStaff(req.params.id);
    await payment.deleteOne();

    logActivity(req, {
      action: "deleted",
      entity: "Salary",
      entityId: req.params.paymentId,
      message: `₹${payment.amount} salary payment removed from ${employee?.name || "an employee"}`,
    });

    if (employee) {
      notifyUser(employee._id, {
        type: "general",
        title: "A salary entry was corrected",
        message: `A recorded payment of ₹${payment.amount.toLocaleString("en-IN")} was removed.`,
        link: "/employee/dashboard",
      });
    }

    return res.status(200).json({ message: "Payment removed" });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That payment was not found" });
    }
    console.error("removePayment error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
