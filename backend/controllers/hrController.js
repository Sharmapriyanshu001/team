import fs from "fs";

import Attendance from "../models/Attendance.js";
import Candidate, { HIRE_AS_ROLES } from "../models/Candidate.js";
import JobOpening from "../models/JobOpening.js";
import Leave, { countLeaveDays } from "../models/Leave.js";
import LeavePolicy from "../models/LeavePolicy.js";
import Team, { ACTIVE_TEAM } from "../models/Team.js";
import User, { ADMIN_ROLES, DEPARTMENT_ROLES } from "../models/User.js";

import { buildCrud, InvalidInput } from "../utils/crud.js";
import { uploadedAs } from "../utils/staffDocuments.js";
import { copyStoredDocument, removeStoredFile, storedPath } from "../utils/uploads.js";
import { logActivity } from "../utils/activity.js";
import { notifyUser, notifyUsers } from "../utils/notify.js";
import { administratorIds } from "./employee/leaveController.js";
import { hashPassword } from "../utils/password.js";

/**
 * The people side of the company: who works here, who is joining, and who is
 * away.
 *
 * Employees and attendance already had screens of their own and keep them —
 * this is the two halves that did not exist in this build: leave, and hiring.
 * Both had real rows sitting in the database with no code to read them.
 */

/** Roles that show up in HR's lists. Administrators are managed elsewhere. */
const STAFF_ROLES = ["manager", "operations_manager", "employee", ...DEPARTMENT_ROLES];

/**
 * Whoever is asking.
 *
 * These handlers serve two panels — the admin one, where the account is on
 * `req.admin`, and HR's own, where it is on `req.hr`. Reading only the first
 * would have left every leave filed from the HR panel with no record of who
 * filed it, which is precisely what these fields exist for.
 */
const actorOf = (req) => req.admin || req.hr;

const startOfMonth = (year, month) => new Date(year, month - 1, 1);
const endOfMonth = (year, month) => new Date(year, month, 0, 23, 59, 59, 999);

/* ------------------------------------------------------------------ leave */

/**
 * A leave overlapping one already filed is nearly always a double entry, and
 * once it is in, every balance and every attendance sheet built on it is
 * quietly wrong. Cheaper to refuse than to reconcile later.
 */
const findOverlap = async (employee, fromDate, toDate, excludeId) =>
  Leave.findOne({
    employee,
    _id: { $ne: excludeId || null },
    status: { $in: ["pending", "approved"] },
    fromDate: { $lte: toDate },
    toDate: { $gte: fromDate },
  }).select("fromDate toDate status");

export const leaves = buildCrud(Leave, {
  entity: "Leave",
  searchFields: ["reason", "decisionNote"],
  filterFields: ["status", "type", "employee"],
  populate: [
    { path: "employee", select: "name email designation department role" },
    { path: "decidedBy", select: "name" },
  ],
  sort: { fromDate: -1 },

  // Anything overlapping the month being looked at, not only what starts in it
  extraQuery: (req) => {
    const { year, month } = req.query;
    if (!year || !month) return {};

    return {
      fromDate: { $lte: endOfMonth(Number(year), Number(month)) },
      toDate: { $gte: startOfMonth(Number(year), Number(month)) },
    };
  },

  beforeSave: async (payload, req, existing) => {
    const data = { ...payload };

    const employee = data.employee || existing?.employee;
    if (!employee) throw new InvalidInput("Choose who this leave is for");

    const from = new Date(data.fromDate ?? existing?.fromDate);
    const to = new Date(data.toDate ?? existing?.toDate);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new InvalidInput("Enter both a start and an end date");
    }
    if (to < from) throw new InvalidInput("The end date is before the start date");

    /**
     * Only worth asking when this save could actually create a clash.
     *
     * Checking it on every update was wrong in a way that showed up on real
     * rows immediately: two overlapping leaves already existed in this
     * database, so neither could be edited at all — not the reason, not the
     * note, nothing — because the check re-ran against the other one and
     * refused a save that never touched a date.
     *
     * A rejected or cancelled leave occupies no days, so it cannot clash with
     * anything either way.
     */
    const status = data.status ?? existing?.status ?? "pending";
    const occupiesDays = !["rejected", "cancelled"].includes(status);

    const datesMoved =
      !existing ||
      from.getTime() !== new Date(existing.fromDate).getTime() ||
      to.getTime() !== new Date(existing.toDate).getTime() ||
      (data.type !== undefined && data.type !== existing.type) ||
      (data.employee !== undefined && String(data.employee) !== String(existing.employee));

    if (occupiesDays && datesMoved) {
      const clash = await findOverlap(employee, from, to, existing?._id);
      if (clash) {
        throw new InvalidInput(
          `That overlaps ${clash.status === "approved" ? "an" : "a"} ${clash.status} leave from ` +
            `${clash.fromDate.toLocaleDateString("en-IN")} to ` +
            `${clash.toDate.toLocaleDateString("en-IN")}`
        );
      }
    }

    // Recomputed here as well as in the pre-save hook, because this number is
    // what every balance is built from and a caller sending its own is not
    // something to take on trust.
    data.days = countLeaveDays(from, to, data.type ?? existing?.type ?? "casual");

    if (!existing) data.appliedBy = actorOf(req)?._id;

    // Only the decision route may set these. Left settable here, a decision
    // could be rewritten later by anybody, with no trace of the swap.
    delete data.decidedBy;
    delete data.decidedByName;
    delete data.decidedAt;

    return data;
  },

  afterSave: (doc, req, { isNew }) => {
    if (!isNew || !doc.employee) return;

    notifyUser(doc.employee, {
      type: "general",
      title: "A leave request was filed for you",
      message: `${doc.days} day${doc.days === 1 ? "" : "s"} from ${new Date(
        doc.fromDate
      ).toLocaleDateString("en-IN")}`,
    });
  },
});

/**
 * PUT /api/admin/hr/leaves/:id/decide   { status, decisionNote }
 *
 * Approving is its own route rather than a field on the ordinary edit, because
 * it is the one change that has to record who made it.
 */
export const decideLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id).populate("employee", "name");
    if (!leave) return res.status(404).json({ message: "Leave not found" });

    const status = String(req.body.status || "").trim();
    if (!["approved", "rejected", "cancelled", "pending"].includes(status)) {
      return res.status(400).json({ message: "Choose approve, reject or cancel" });
    }

    /**
     * The overlap check moved off the ordinary edit, so approving is where it
     * has to be asked instead — that is the moment days actually get taken,
     * and approving two leaves over the same day is the double-book the check
     * exists to stop.
     */
    if (status === "approved" && leave.status !== "approved") {
      /**
       * The raw id, not the populated document.
       *
       * `populate` replaces the path with the User it found — and with null
       * when it finds nothing, which two rows in this database do: they point
       * at an account that no longer exists. Reading the id off the populated
       * value therefore passed `undefined` to the overlap query on exactly the
       * rows most likely to be wrong, and it matched nothing every time.
       * `populated()` hands back what was stored regardless.
       */
      const employeeId = leave.populated("employee") || leave.employee?._id || leave.employee;

      const clash = await findOverlap(employeeId, leave.fromDate, leave.toDate, leave._id);
      if (clash?.status === "approved") {
        return res.status(400).json({
          message:
            `That overlaps an approved leave from ` +
            `${clash.fromDate.toLocaleDateString("en-IN")} to ` +
            `${clash.toDate.toLocaleDateString("en-IN")}`,
        });
      }
    }

    leave.status = status;
    leave.decisionNote = String(req.body.decisionNote || "").trim();
    leave.decidedBy = actorOf(req)?._id;
    leave.decidedByName = actorOf(req)?.name || "";

    await leave.save();

    logActivity(req, {
      action: "updated",
      entity: "Leave",
      entityId: leave._id,
      message: `Leave for ${leave.employee?.name || "an employee"} ${status}`,
    });

    notifyUser(leave.employee?._id, {
      type: "general",
      title: `Your leave was ${status}`,
      message: leave.decisionNote || "",
    });

    /**
     * The administrators are told too.
     *
     * They can already see every leave on their own screen, so this is not
     * about access — it is that a decision somebody should know about is not
     * something they should have to go looking for. Only the outcome is sent;
     * the reason a person gave for needing the days stays between them and HR.
     *
     * Fire-and-forget, like every other notification here: a failure to tell
     * somebody must never undo a decision that has already been made.
     */
    administratorIds()
      .then((admins) =>
        notifyUsers(admins, {
          type: "general",
          title: `Leave ${status} by HR`,
          message: `${leave.employee?.name || "An employee"} — ${leave.days} day${
            leave.days === 1 ? "" : "s"
          } from ${new Date(leave.fromDate).toLocaleDateString("en-IN")}`,
          link: "/admin/hr/leave",
        })
      )
      .catch((err) => console.error("notify admins error:", err.message));

    return res.status(200).json({ message: `Leave ${status}`, item: leave });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Leave not found" });
    console.error("decideLeave error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/admin/hr/leaves/balances?year=
 *
 * What everybody has taken this year against what the policies grant.
 *
 * Computed on read rather than stored, because a stored balance is only as
 * correct as the last time somebody remembered to recalculate it — and the
 * moment one approval is edited, every stored figure downstream is a lie.
 */
export const leaveBalances = async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const from = new Date(year, 0, 1);
    const to = new Date(year, 11, 31, 23, 59, 59, 999);

    const now = new Date();

    /**
     * How much of the year has been earned.
     *
     * A twelve-day allowance is not twelve days on the 1st of January — it is
     * one a month. Showing the whole year's quota from day one told a new
     * starter in February they had eleven days in hand, which is how somebody
     * books a holiday they have not accrued and HR has an awkward conversation.
     *
     * A past year is complete; the current year stops at the month we are in;
     * a future year has earned nothing yet.
     */
    const monthsElapsed =
      year < now.getFullYear() ? 12 : year > now.getFullYear() ? 0 : now.getMonth() + 1;

    const [staff, policies, taken, pending] = await Promise.all([
      User.find({ role: { $in: STAFF_ROLES }, status: "active" })
        .select("name email role designation department joiningDate")
        .sort({ name: 1 }),
      LeavePolicy.find({ active: true }).sort({ name: 1 }),
      /**
       * Grouped by month as well as by type, which is what makes the monthly
       * record possible. Counted against the month the leave STARTS in — a
       * break spanning the 30th to the 2nd belongs to the month it was asked
       * for, and splitting it across two would make neither month add up.
       */
      Leave.aggregate([
        { $match: { status: "approved", fromDate: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: {
              employee: "$employee",
              type: "$type",
              month: { $month: "$fromDate" },
            },
            days: { $sum: "$days" },
          },
        },
      ]),
      /**
       * What is asked for but not yet decided.
       *
       * Deliberately kept out of every figure below — a balance counts what
       * has happened, and a request nobody has approved has not happened. It
       * is reported alongside instead, because the person approving one needs
       * to know the other four days already sitting in the queue behind it.
       */
      Leave.aggregate([
        { $match: { status: "pending", fromDate: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: "$employee",
            days: { $sum: "$days" },
            requests: { $sum: 1 },
          },
        },
      ]),
    ]);

    // { employeeId: { byType: { casual: 3 }, byMonth: [0,0,2,...] } }
    const byEmployee = {};
    taken.forEach((row) => {
      const id = String(row._id.employee);
      byEmployee[id] = byEmployee[id] || { byType: {}, byMonth: Array(12).fill(0) };
      byEmployee[id].byType[row._id.type] =
        (byEmployee[id].byType[row._id.type] || 0) + row.days;
      // $month is 1-12
      byEmployee[id].byMonth[row._id.month - 1] += row.days;
    });

    const pendingByEmployee = {};
    pending.forEach((row) => {
      pendingByEmployee[String(row._id)] = { days: row.days, requests: row.requests };
    });

    const quotas = {};
    policies.forEach((policy) => {
      quotas[policy.type] = (quotas[policy.type] || 0) + (policy.annualQuota || 0);
    });
    const totalQuota = Object.values(quotas).reduce((sum, n) => sum + n, 0);

    /** One month's worth of the whole allowance. Kept to one decimal. */
    const perMonth = Math.round((totalQuota / 12) * 10) / 10;

    const rows = staff.map((person) => {
      const record = byEmployee[String(person._id)] || {
        byType: {},
        byMonth: Array(12).fill(0),
      };
      const used = record.byType;
      const totalUsed = Object.values(used).reduce((sum, n) => sum + n, 0);

      /**
       * Somebody who joined in August has not been earning since January.
       * Their first accruing month is the one they joined in; a joining date
       * in a later year means nothing has accrued at all.
       */
      const joined = person.joiningDate ? new Date(person.joiningDate) : null;
      const startMonth =
        joined && joined.getFullYear() === year
          ? joined.getMonth()
          : joined && joined.getFullYear() > year
            ? 12
            : 0;

      let running = 0;
      const months = Array.from({ length: 12 }, (_, i) => {
        const earned = i >= startMonth && i < monthsElapsed ? perMonth : 0;
        const takenThisMonth = record.byMonth[i];
        running = Math.round((running + earned - takenThisMonth) * 10) / 10;

        return {
          month: i + 1,
          accrued: earned,
          taken: takenThisMonth,
          // What was in hand at the end of that month — the running figure,
          // which is the column somebody actually reads down.
          balance: running,
        };
      });

      const accrued =
        Math.round(months.reduce((sum, m) => sum + m.accrued, 0) * 10) / 10;

      return {
        employee: {
          _id: person._id,
          name: person.name,
          email: person.email,
          role: person.role,
          designation: person.designation,
          department: person.department,
          joiningDate: person.joiningDate || null,
        },
        used,
        totalUsed,
        totalQuota,
        /** Earned so far this year, month by month. */
        accrued,
        /**
         * What they can actually book today. Floored at zero: an employee
         * cannot book minus two days.
         */
        available: Math.max(0, Math.round((accrued - totalUsed) * 10) / 10),
        /**
         * The same subtraction without the floor, which is the one HR needs.
         *
         * `available` answers "may they book", and zero is the right answer
         * for somebody who has overdrawn. But it makes a person two days in
         * the red look identical to a person exactly at nil, and those are
         * not the same conversation — so the signed figure is reported too
         * and the screen shows the shortfall rather than rounding it away.
         */
        net: Math.round((accrued - totalUsed) * 10) / 10,
        /** The whole year's entitlement minus what is gone, as before. */
        remaining: Math.max(0, totalQuota - totalUsed),
        /** Asked for, not yet decided. Counted against nothing. */
        pending: pendingByEmployee[String(person._id)] || { days: 0, requests: 0 },
        months,
      };
    });

    return res.status(200).json({
      year,
      quotas,
      policies,
      rows,
      accrual: { perMonth, monthsElapsed, totalQuota },
    });
  } catch (err) {
    console.error("leaveBalances error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------- leave policies */

export const leavePolicies = buildCrud(LeavePolicy, {
  entity: "Leave policy",
  searchFields: ["name", "notes"],
  filterFields: ["type", "active"],
  sort: { name: 1 },

  beforeSave: async (payload, req, existing) => {
    const data = { ...payload, updatedBy: actorOf(req)?._id };

    /**
     * One policy per leave type — the database enforces it with a unique
     * index on `type` that predates this code, and the six policies already
     * on file respect it.
     *
     * Caught here so the refusal says what actually clashed. Left to the
     * duplicate-key handler it comes back as "a record with this value
     * already exists", which does not tell somebody staring at a form with
     * eight fields on it which one to change.
     */
    const type = data.type ?? existing?.type;
    if (type) {
      const clash = await LeavePolicy.findOne({
        type,
        _id: { $ne: existing?._id || null },
      }).select("name");

      if (clash) {
        throw new InvalidInput(
          `"${clash.name}" is already the policy for ${type.replace(/_/g, " ")} ` +
            "leave — edit that one rather than adding a second"
        );
      }
    }

    return data;
  },
});

/* ------------------------------------------------------------ recruitment */

export const candidates = buildCrud(Candidate, {
  entity: "Candidate",
  searchFields: ["name", "email", "phone", "position", "department", "skills"],
  filterFields: ["stage", "source", "owner", "department"],
  populate: [
    { path: "owner", select: "name email" },
    { path: "hiredUser", select: "name email role" },
  ],
  sort: { createdAt: -1 },

  beforeSave: (payload, req, existing) => {
    const data = { ...payload };

    if (data.owner === "") data.owner = null;
    /**
     * "Not against an opening" is a real answer, and a multipart form sends it
     * as "" rather than leaving the field out — which Mongoose would try to
     * cast to an ObjectId and refuse.
     */
    if (data.jobOpening === "") data.jobOpening = null;
    if (!existing) data.createdBy = actorOf(req)?._id;

    /**
     * The CV, when one came with this save.
     *
     * A save that carries no file leaves whatever is on record alone: editing
     * a candidate's phone number must not throw their CV away. Replacing one
     * takes the old bytes off the disk, but only once the record holding the
     * new name has been written — an unlinked file that is still referenced is
     * worse than an orphan nobody reads.
     */
    const resume = uploadedAs(req, "resume");
    if (resume) {
      data.resume = resume;

      const previous = existing?.resume?.storedName;
      if (previous && previous !== resume.storedName) {
        req.res?.on("finish", () => {
          if (req.res.statusCode < 400) removeStoredFile(previous);
        });
      }
    } else {
      delete data.resume;
    }

    // Skills arrive as either a list or a comma-separated line depending on
    // which form is open. Both mean the same thing.
    if (typeof data.skills === "string") {
      data.skills = data.skills
        .split(",")
        .map((skill) => skill.trim())
        .filter(Boolean);
    }

    /**
     * Hiring is what creates a staff account, and that only happens on the
     * hire route — which checks the email is free and hands back the login to
     * pass on. Letting a plain edit set this stage would mark somebody hired
     * with no account anywhere to show for it.
     */
    if (data.stage === "hired" && existing?.stage !== "hired" && !existing?.hiredUser) {
      throw new InvalidInput(
        "Use Hire on the candidate to create their account — it sets this stage itself"
      );
    }

    return data;
  },

  afterSave: (doc, req, { isNew, previous }) => {
    if (!doc.owner) return;
    if (!isNew && String(previous?.owner || "") === String(doc.owner)) return;

    notifyUser(doc.owner, {
      type: "assignment",
      title: "A candidate was assigned to you",
      message: `${doc.name}${doc.position ? ` — ${doc.position}` : ""}`,
      link: "/admin/hr/recruitment",
    });
  },
});

/**
 * Handing back one candidate's CV.
 *
 * The same rule the staff documents follow: nothing under uploads/ is served
 * statically, so this is the only way to read it and it sits behind the guard
 * the rest of the recruitment routes sit behind.
 */
export const candidateResume = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id).select("resume name");
    if (!candidate) return res.status(404).json({ message: "Candidate not found" });

    const file = candidate.resume;
    const target = file?.storedName && storedPath(file.storedName);
    if (!target) return res.status(404).json({ message: "No CV on file for this candidate" });

    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    // Opened in a tab rather than downloaded: this is read while somebody is
    // deciding whether to call the person, not collected.
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${(file.originalName || "cv").replace(/"/g, "")}"`
    );

    const stream = fs.createReadStream(target);
    stream.on("error", (err) => {
      console.error("candidateResume stream error:", err.message);
      if (!res.headersSent) res.status(500).json({ message: "Could not read that CV" });
    });
    return stream.pipe(res);
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Candidate not found" });
    console.error("candidateResume error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** POST /api/admin/hr/candidates/:id/interviews */
export const addInterview = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Candidate not found" });

    const round = String(req.body.round || "").trim();
    if (!round) return res.status(400).json({ message: "Name the round first" });

    let interviewerName = String(req.body.interviewerName || "").trim();
    if (req.body.interviewer && !interviewerName) {
      const person = await User.findById(req.body.interviewer).select("name");
      interviewerName = person?.name || "";
    }

    candidate.interviews.push({
      round,
      scheduledAt: req.body.scheduledAt || undefined,
      mode: String(req.body.mode || "").trim(),
      interviewer: req.body.interviewer || undefined,
      interviewerName,
      feedback: String(req.body.feedback || "").trim(),
      rating: Number(req.body.rating) || 0,
      outcome: req.body.outcome || "scheduled",
    });

    // Scheduling a round is what moves somebody into the interview stage.
    // Making HR remember to also change a dropdown is how stages go stale.
    if (["applied", "screening"].includes(candidate.stage)) candidate.stage = "interview";

    await candidate.save();

    if (req.body.interviewer) {
      notifyUser(req.body.interviewer, {
        type: "general",
        title: "You have an interview to take",
        message: `${candidate.name} — ${round}`,
        link: "/admin/hr/recruitment",
      });
    }

    return res.status(201).json({ message: "Interview added", item: candidate });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Candidate not found" });
    console.error("addInterview error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** PUT /api/admin/hr/candidates/:id/interviews/:interviewId */
export const updateInterview = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Candidate not found" });

    const round = candidate.interviews.id(req.params.interviewId);
    if (!round) return res.status(404).json({ message: "That round is not on file" });

    ["round", "mode", "feedback", "outcome"].forEach((field) => {
      if (req.body[field] !== undefined) round[field] = req.body[field];
    });
    if (req.body.scheduledAt !== undefined) round.scheduledAt = req.body.scheduledAt || undefined;
    if (req.body.rating !== undefined) round.rating = Number(req.body.rating) || 0;

    await candidate.save();
    return res.status(200).json({ message: "Interview updated", item: candidate });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Candidate not found" });
    console.error("updateInterview error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** DELETE /api/admin/hr/candidates/:id/interviews/:interviewId */
export const removeInterview = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Candidate not found" });

    const round = candidate.interviews.id(req.params.interviewId);
    if (!round) return res.status(404).json({ message: "That round is not on file" });

    round.deleteOne();
    await candidate.save();

    return res.status(200).json({ message: "Interview removed", item: candidate });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Candidate not found" });
    console.error("removeInterview error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/admin/hr/candidates/:id/hire
 *
 * Turn a candidate into a member of staff with a login.
 *
 * The mirror of converting a lead: the candidate is kept and linked rather
 * than deleted, because time-to-hire and which source produced it are the only
 * things that say whether the recruiting is working, and both die with the
 * record. The password follows the same rule as every other account this panel
 * creates — the person's mobile number unless one is typed in.
 */
export const hireCandidate = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Candidate not found" });

    if (candidate.hiredUser) {
      return res.status(409).json({ message: "This candidate has already been hired" });
    }

    const email = String(req.body.email || candidate.email || "")
      .trim()
      .toLowerCase();
    if (!email) {
      return res.status(400).json({ message: "Add an email address before hiring" });
    }

    const taken = await User.findOne({ email }).select("_id");
    if (taken) {
      return res.status(409).json({ message: `An account already uses ${email}` });
    }

    const phone = String(req.body.phone || candidate.phone || "").trim();
    const typed = String(req.body.password || "").trim();

    if (!typed && !phone) {
      return res
        .status(400)
        .json({ message: "Enter a mobile number — it becomes the login password" });
    }
    if (typed && typed.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const password = typed || phone;

    /**
     * The role a hire lands on comes from the request, so it is checked rather
     * than trusted. Unchecked, this route mints any account the User enum
     * allows — including "super_admin" — which would make hiring a candidate
     * the shortest path to an administrator login in the whole application.
     *
     * HIRE_AS_ROLES is the whitelist and contains no administrator role.
     */
    const role = req.body.role || candidate.hireAs || "employee";

    if (!HIRE_AS_ROLES.includes(role)) {
      return res.status(400).json({
        message: "A candidate cannot be hired into that role",
      });
    }

    /**
     * Hiring somebody into a department is creating a department login, and
     * that is a decision reserved to a full administrator — the department
     * accounts routes are closed to department users by requireFullAdmin for
     * exactly this reason.
     *
     * Without this check, hiring would be the way round it: an HR account
     * could add a candidate, hire them "as HR", and have minted a colleague
     * with HR access that it was never allowed to create directly.
     */
    if (DEPARTMENT_ROLES.includes(role) && !ADMIN_ROLES.includes(req.admin?.role)) {
      return res.status(403).json({
        message:
          "Only an administrator can hire somebody into a department role — " +
          "ask them to create the account from Department Accounts",
      });
    }

    /**
     * The onboarding record is what was actually agreed with this person —
     * their joining date, their designation, who they report to — collected
     * over the days between selecting them and their first morning. It is
     * preferred over the candidate's original application, and over nothing
     * at all, so hiring from the Onboarding screen does not ask again for
     * details somebody already filled in.
     */
    const onboarding = candidate.onboarding || {};

    /**
     * Their CV, and where they live.
     *
     * Both are asked for at the moment of hiring rather than left for the
     * paperwork screen, because this is the one conversation where HR has the
     * person's attention and their documents open in front of them. The CV
     * arrives as a real upload — the candidate record only ever had a URL,
     * which is a link to somebody else's Google Drive and stops working the
     * week the applicant tidies theirs up.
     *
     * Both are optional. A hire that gets held up over a missing address is a
     * person who cannot see their tasks on their first morning.
     */
    /**
     * A CV attached here wins; otherwise the one the application arrived with
     * carries across. Before candidates could hold a CV this was the only
     * chance to capture it, and asking HR to find the same PDF a second time
     * on the day they hire is how staff records end up without one.
     */
    const resume =
      uploadedAs(req, "resume") ||
      // Copied rather than shared: the candidate row is kept after the hire,
      // so two records pointing at one file is a delete away from a broken one
      (candidate.resume?.storedName ? copyStoredDocument(candidate.resume) : null);
    const address = String(req.body.address || candidate.address || "").trim();

    const user = await User.create({
      name: candidate.name,
      email,
      password: hashPassword(password),
      role,
      phone,
      designation: req.body.designation || onboarding.designation || candidate.position || "",
      department: req.body.department || onboarding.department || candidate.department || "",
      joiningDate: req.body.joiningDate || onboarding.joiningDate || new Date(),
      status: "active",
      reportsTo: req.body.reportsTo || onboarding.reportsTo || undefined,
      address,
      ...(resume ? { documents: { resume } } : {}),
    });

    candidate.hiredUser = user._id;
    candidate.stage = "hired";
    if (address) candidate.address = address;
    candidate.hiredAt = candidate.hiredAt || new Date();
    if (req.body.offeredSalary !== undefined) {
      candidate.offeredSalary = Number(req.body.offeredSalary) || 0;
    }

    /**
     * Onboarding is complete when there is an account, not when the last box
     * is ticked — any other definition lets somebody be marked complete with
     * nothing to show for it. See the note on the model.
     */
    candidate.onboarding = {
      ...(onboarding.toObject?.() || onboarding),
      startedAt: onboarding.startedAt || new Date(),
      completedAt: new Date(),
    };

    await candidate.save();

    /**
     * The vacancy this closes.
     *
     * An opening is for a number of seats, so it is filled when that many
     * people have joined and not when the first one has — counting the hires
     * is the only way to get that right when two people are taken on for the
     * same role. Left alone if somebody has already closed it by hand.
     */
    if (candidate.jobOpening) {
      try {
        const opening = await JobOpening.findById(candidate.jobOpening);

        if (opening?.isLive()) {
          const hired = await Candidate.countDocuments({
            jobOpening: opening._id,
            stage: "hired",
          });

          if (hired >= (opening.positions || 1)) {
            opening.status = "filled";
            await opening.save();

            logActivity(req, {
              action: "updated",
              entity: "Job opening",
              entityId: opening._id,
              message: `"${opening.title}" filled — ${hired} of ${opening.positions} joined`,
            });
          }
        }
      } catch (err) {
        // A vacancy that failed to close is a tidy-up problem, not a reason to
        // fail a hire that has already created the person's account
        console.error("closing job opening after hire:", err.message);
      }
    }

    logActivity(req, {
      action: "created",
      entity: "User",
      entityId: user._id,
      message: `Candidate "${candidate.name}" hired as ${role.replace(/_/g, " ")}`,
    });

    return res.status(201).json({
      message: `${candidate.name} hired`,
      candidate,
      user: { _id: user._id, name: user.name, email: user.email, role: user.role },
      credentials: { loginId: email, password },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "An account already uses that email" });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("hireCandidate error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------- HR overview */

/**
 * GET /api/admin/hr/overview
 *
 * The screen an HR account lands on: headcount, who is away, what is waiting
 * for a decision, and where the hiring stands. Every number here is counted
 * from the collections on read, so none of it can drift.
 */
export const hrOverview = async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;

    const from = startOfMonth(year, month);
    const to = endOfMonth(year, month);
    const today = new Date(new Date().setHours(0, 0, 0, 0));
    const endToday = new Date(new Date().setHours(23, 59, 59, 999));

    const [
      headcountRows,
      activeCount,
      inactiveCount,
      joinedThisMonth,
      pendingLeaves,
      leavesThisMonth,
      onLeaveToday,
      candidateRows,
      hiredThisMonth,
      attendanceRows,
      teams,
      withInterviews,
    ] = await Promise.all([
      User.aggregate([
        { $match: { role: { $in: STAFF_ROLES } } },
        { $group: { _id: "$role", count: { $sum: 1 } } },
      ]),
      User.countDocuments({ role: { $in: STAFF_ROLES }, status: "active" }),
      User.countDocuments({ role: { $in: STAFF_ROLES }, status: "inactive" }),
      User.countDocuments({ role: { $in: STAFF_ROLES }, joiningDate: { $gte: from, $lte: to } }),

      Leave.countDocuments({ status: "pending" }),
      Leave.countDocuments({ fromDate: { $lte: to }, toDate: { $gte: from } }),
      Leave.find({ status: "approved", fromDate: { $lte: endToday }, toDate: { $gte: today } })
        .populate("employee", "name designation department")
        .select("employee type fromDate toDate days")
        .limit(20),

      Candidate.aggregate([{ $group: { _id: "$stage", count: { $sum: 1 } } }]),
      Candidate.countDocuments({ stage: "hired", hiredAt: { $gte: from, $lte: to } }),

      Attendance.aggregate([
        { $match: { date: { $gte: from, $lte: to } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      Team.find({ ...ACTIVE_TEAM }).select("name kind members operationsManagers manager"),

      Candidate.find({ "interviews.scheduledAt": { $gte: today } })
        .select("name position interviews")
        .limit(15),
    ]);

    const byRole = {};
    headcountRows.forEach((row) => {
      byRole[row._id] = row.count;
    });

    const pipeline = {};
    candidateRows.forEach((row) => {
      pipeline[row._id] = row.count;
    });

    const attendance = {};
    attendanceRows.forEach((row) => {
      attendance[row._id] = row.count;
    });

    const marked = Object.values(attendance).reduce((sum, n) => sum + n, 0);
    const present = (attendance.present || 0) + (attendance.half_day || 0) * 0.5;

    /**
     * A document matching on "some round is in the future" still carries all
     * its past rounds, so the future ones are picked out here rather than
     * trusted from the match.
     */
    const upcoming = withInterviews
      .flatMap((candidate) =>
        candidate.interviews
          .filter((round) => round.scheduledAt && round.scheduledAt >= today)
          .map((round) => ({
            candidateId: candidate._id,
            candidate: candidate.name,
            position: candidate.position,
            round: round.round,
            mode: round.mode,
            outcome: round.outcome,
            scheduledAt: round.scheduledAt,
            interviewerName: round.interviewerName,
          }))
      )
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
      .slice(0, 10);

    return res.status(200).json({
      period: { year, month },
      headcount: {
        total: Object.values(byRole).reduce((sum, n) => sum + n, 0),
        active: activeCount,
        inactive: inactiveCount,
        joinedThisMonth,
        byRole,
      },
      leave: {
        pending: pendingLeaves,
        thisMonth: leavesThisMonth,
        onLeaveToday: onLeaveToday.map((row) => ({
          _id: row._id,
          employee: row.employee,
          type: row.type,
          fromDate: row.fromDate,
          toDate: row.toDate,
          days: row.days,
        })),
      },
      recruitment: {
        pipeline,
        open: Object.entries(pipeline)
          .filter(([stage]) => !["hired", "rejected"].includes(stage))
          .reduce((sum, [, count]) => sum + count, 0),
        hiredThisMonth,
        upcoming,
      },
      attendance: {
        counts: attendance,
        marked,
        rate: marked ? Math.round((present / marked) * 100) : 0,
      },
      teams: teams.map((team) => ({
        _id: team._id,
        name: team.name,
        kind: team.kind,
        size: team.everyone().length,
      })),
    });
  } catch (err) {
    console.error("hrOverview error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
