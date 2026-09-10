import Leave, { LEAVE_TYPES, countLeaveDays } from "../../models/Leave.js";
import LeavePolicy from "../../models/LeavePolicy.js";
import User, { ADMIN_ROLES, HR_PANEL_ROLES } from "../../models/User.js";

import { logActivity } from "../../utils/activity.js";
import { notifyUsers } from "../../utils/notify.js";

/**
 * Applying for leave, from the employee's own panel.
 *
 * The other half of HR's leave screens: HR could already file and decide a
 * leave on somebody's behalf, but the person actually taking the day had no
 * way to ask for it. This is that route, and deliberately nothing more.
 *
 * Everything here is scoped to `req.employee._id` at the query level rather
 * than by trusting a field in the body. An employee may see, file and withdraw
 * their own requests and nobody else's — and they may never decide one, not
 * even their own. Approval lives on PUT /api/hr/leaves/:id/decide and stays
 * there; a second decision path is how an employee ends up approving their own
 * leave through a route nobody remembered to check.
 */

/** What the employee's own list and detail responses look like. */
const shape = (leave) => ({
  _id: leave._id,
  type: leave.type,
  fromDate: leave.fromDate,
  toDate: leave.toDate,
  days: leave.days,
  reason: leave.reason || "",
  status: leave.status,
  decisionNote: leave.decisionNote || "",
  decidedByName: leave.decidedByName || "",
  decidedAt: leave.decidedAt || null,
  createdAt: leave.createdAt,
});

/* ------------------------------------------------------------------ list */

/**
 * GET /api/employee/leaves
 *
 * This person's own requests, newest first, with a small tally so the panel
 * can say "2 pending" without counting the rows itself.
 */
export const myLeaves = async (req, res) => {
  try {
    const query = { employee: req.employee._id };

    const status = String(req.query.status || "").trim();
    if (status && status !== "all") query.status = status;

    const year = Number(req.query.year);
    if (year) {
      query.fromDate = { $lte: new Date(year, 11, 31, 23, 59, 59, 999) };
      query.toDate = { $gte: new Date(year, 0, 1) };
    }

    const leaves = await Leave.find(query).sort({ fromDate: -1 });

    /**
     * Counted over every request this person has ever filed, not the filtered
     * list, so the tally does not change meaning when a filter is applied.
     */
    const all = await Leave.find({ employee: req.employee._id }).select("status days");
    const counts = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
    let daysApproved = 0;

    all.forEach((leave) => {
      counts[leave.status] = (counts[leave.status] || 0) + 1;
      if (leave.status === "approved") daysApproved += leave.days || 0;
    });

    return res.status(200).json({
      items: leaves.map(shape),
      total: leaves.length,
      counts,
      daysApproved,
    });
  } catch (err) {
    console.error("myLeaves error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- policies */

/**
 * GET /api/employee/leave-policies
 *
 * The kinds of leave that may be asked for, so the form offers what this
 * company actually grants rather than a hard-coded list that drifts from it.
 * Read-only, and only the active ones.
 */
export const myLeavePolicies = async (req, res) => {
  try {
    const policies = await LeavePolicy.find({ active: true })
      .select("name description type annualQuota paid noticeDays maxConsecutiveDays notes")
      .sort({ name: 1 });

    return res.status(200).json({ items: policies, types: LEAVE_TYPES });
  } catch (err) {
    console.error("myLeavePolicies error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ----------------------------------------------------------------- apply */

/**
 * POST /api/employee/leaves
 *
 * Files a request. It is always created pending — the status is never read
 * from the body, so there is no shape of request that files an approved leave
 * for oneself.
 */
export const applyForLeave = async (req, res) => {
  try {
    const type = String(req.body.type || "casual").trim();
    if (!LEAVE_TYPES.includes(type)) {
      return res.status(400).json({ message: "Choose a valid kind of leave" });
    }

    const from = new Date(req.body.fromDate);
    const to = new Date(req.body.toDate || req.body.fromDate);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ message: "Enter both a start and an end date" });
    }
    if (to < from) {
      return res.status(400).json({ message: "The end date is before the start date" });
    }

    const reason = String(req.body.reason || "").trim();
    if (!reason) {
      return res.status(400).json({ message: "Say why you need the leave" });
    }

    /**
     * The same overlap rule HR's own screens apply. Asked here as well as
     * there because this is where most requests will now come from, and a
     * double-booked day is far cheaper to refuse than to reconcile after both
     * halves have been approved.
     */
    const clash = await Leave.findOne({
      employee: req.employee._id,
      status: { $in: ["pending", "approved"] },
      fromDate: { $lte: to },
      toDate: { $gte: from },
    }).select("fromDate toDate status");

    if (clash) {
      return res.status(400).json({
        message:
          `You already have a ${clash.status} leave from ` +
          `${clash.fromDate.toLocaleDateString("en-IN")} to ` +
          `${clash.toDate.toLocaleDateString("en-IN")}`,
      });
    }

    const leave = await Leave.create({
      employee: req.employee._id,
      type,
      fromDate: from,
      toDate: to,
      reason,
      // Never from the body. A request from this panel is a request.
      status: "pending",
      appliedBy: req.employee._id,
    });

    logActivity(req, {
      action: "created",
      entity: "Leave",
      entityId: leave._id,
      message: `${req.employee.name} applied for ${leave.days} day${
        leave.days === 1 ? "" : "s"
      } of ${type.replace(/_/g, " ")} leave`,
    });

    /**
     * The request has to land somewhere a person will see it. HR decides these,
     * so every active HR account is told — the head and the managers alike,
     * because whoever is at their desk should be able to pick it up.
     */
    const hrTeam = await User.find({
      role: { $in: HR_PANEL_ROLES },
      status: "active",
    }).distinct("_id");

    notifyUsers(hrTeam, {
      type: "general",
      title: "New leave request",
      message: `${req.employee.name} asked for ${leave.days} day${
        leave.days === 1 ? "" : "s"
      } from ${from.toLocaleDateString("en-IN")} — ${reason}`,
      link: "/hr/leave",
    });

    return res.status(201).json({
      message: "Your leave request has been sent to HR",
      item: shape(leave),
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("applyForLeave error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------- get one */

// GET /api/employee/leaves/:id
export const myLeaveDetail = async (req, res) => {
  try {
    const leave = await Leave.findOne({
      _id: req.params.id,
      employee: req.employee._id,
    });
    if (!leave) return res.status(404).json({ message: "That request was not found" });

    return res.status(200).json({ item: shape(leave) });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That request was not found" });
    }
    console.error("myLeaveDetail error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- withdraw */

/**
 * PUT /api/employee/leaves/:id/withdraw
 *
 * Taking back a request that has not been decided yet.
 *
 * Only a pending one, and only your own. Withdrawing an approved leave is not
 * this — those days have been granted and possibly planned around, so putting
 * them back is a conversation with HR rather than a button.
 */
export const withdrawLeave = async (req, res) => {
  try {
    const leave = await Leave.findOne({
      _id: req.params.id,
      employee: req.employee._id,
    });
    if (!leave) return res.status(404).json({ message: "That request was not found" });

    if (leave.status !== "pending") {
      return res.status(400).json({
        message:
          leave.status === "approved"
            ? "That leave has been approved — ask HR to cancel it"
            : `That request was already ${leave.status}`,
      });
    }

    leave.status = "cancelled";
    leave.decisionNote = "Withdrawn by the employee";
    leave.decidedByName = req.employee.name;
    leave.decidedBy = req.employee._id;
    await leave.save();

    logActivity(req, {
      action: "updated",
      entity: "Leave",
      entityId: leave._id,
      message: `${req.employee.name} withdrew their leave request`,
    });

    const hrTeam = await User.find({
      role: { $in: HR_PANEL_ROLES },
      status: "active",
    }).distinct("_id");

    notifyUsers(hrTeam, {
      type: "general",
      title: "Leave request withdrawn",
      message: `${req.employee.name} withdrew their request for ${new Date(
        leave.fromDate
      ).toLocaleDateString("en-IN")}`,
      link: "/hr/leave",
    });

    return res.status(200).json({ message: "Request withdrawn", item: shape(leave) });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That request was not found" });
    }
    console.error("withdrawLeave error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Everybody who should be told when a leave is decided, besides the person who
 * asked.
 *
 * Exported so the HR decision route can use it without owning the question of
 * who "the admins" are — that answer belongs with the roles, not with HR.
 */
export const administratorIds = () =>
  User.find({ role: { $in: ADMIN_ROLES }, status: "active" }).distinct("_id");
