import fs from "fs";

import Attendance from "../../models/Attendance.js";
import Candidate from "../../models/Candidate.js";
import Leave from "../../models/Leave.js";
import Project from "../../models/Project.js";
import Team, { ACTIVE_TEAM } from "../../models/Team.js";
import User, { HR_PANEL_ROLES, LEADER_ROLES } from "../../models/User.js";

import { buildCrud } from "../../utils/crud.js";
import { staffCrudOptions } from "../../utils/staffCrud.js";
import {
  applyStaffPaperwork,
  findPaperwork,
  paperworkFiles,
} from "../../utils/staffDocuments.js";
import { removeStoredFile, storedPath } from "../../utils/uploads.js";
import { logActivity } from "../../utils/activity.js";
import { projectRollup, taskRollup } from "../../utils/staffRollup.js";

/**
 * Who works here — the HR panel's view of the staff directory.
 *
 * Deliberately narrower than the admin panel's. HR maintains the record and
 * needs to see it, so this reads and edits, but it does not create logins and
 * it does not delete people: an account being created is a hiring decision
 * that goes through Recruitment, and deleting somebody takes their name off
 * every task and every leave they ever touched, which is an administrator's
 * call. Both are absent from the routes rather than hidden in the UI.
 */

/** Everybody HR looks after. HR's own logins have their own screen. */
const STAFF_ROLES = ["manager", "operations_manager", "employee", "sales", "operations"];

export const staff = buildCrud(User, {
  entity: "Employee",
  searchFields: ["name", "email", "designation", "department", "phone"],
  filterFields: ["status", "department", "role"],
  scope: { role: { $in: STAFF_ROLES } },
  /**
   * The same reasoning as the admin panel's staff list: nobody reading a table
   * of names needs the whole company's Aadhaar numbers and bank accounts in
   * their browser, so the three heavy sub-documents are left out here and
   * fetched only when one person is actually opened.
   */
  select: "-password -documents -bank -previousEmployment",
  selectOne: "-password",
  populate: [{ path: "reportsTo", select: "name email" }],
  sort: { name: 1 },

  /**
   * The tiles above the table, and the departments its filter may offer.
   * Counted over the whole directory rather than the page in hand, which is
   * the only way "21 active" means anything.
   */
  summary: true,

  /**
   * The paperwork is handled the same way the admin panel handles it.
   *
   * HR's edit form is now the admin's form — the four-step one that carries
   * Aadhaar, PAN, the CV, the bank account and the previous employer — so a
   * save from it arrives as multipart with files on it. Without
   * applyStaffPaperwork those files were written to disk, left off the record
   * and never referenced again: the form would say it saved and the scan
   * would be gone. The separate /employees/:id/documents route still answers
   * for anything that posts only paperwork.
   */
  beforeSave: (payload, req, existing) => {
    const { data: withPapers, orphaned } = applyStaffPaperwork(payload, req, existing);
    const data = { ...withPapers };

    /**
     * Four things this screen must never change, whatever arrives in the
     * body: what somebody may sign in as, and their credentials. HR maintains
     * the record; it does not hand out access from here.
     */
    delete data.role;
    delete data.password;
    delete data.permissionRole;
    delete data.tokenVersion;

    /**
     * Three different things, and they used to be two.
     *
     *   absent   the caller is not talking about the reporting line — an edit
     *            of somebody's phone number must not move them off a manager
     *   ""       the caller means "nobody", which is how HR takes somebody
     *            off a manager without having to pick another one
     *   an id    put them under that person
     *
     * `if (!data.reportsTo) delete` collapsed the first two, so the only way
     * out from under a manager was to be given a different one.
     */
    if (data.reportsTo === undefined) delete data.reportsTo;
    else if (!String(data.reportsTo).trim()) data.reportsTo = null;

    // A scan this save replaced, deleted only once the record itself is
    // written — a failed save must never take the old file with it.
    if (orphaned.length) {
      req.res?.on("finish", () => {
        if (req.res.statusCode < 400) orphaned.forEach(removeStoredFile);
      });
    }

    return data;
  },
});

/**
 * Hiring somebody straight into the directory.
 *
 * This used to be absent on purpose: an account is a hiring decision, and the
 * decision has a place — Candidates, then Onboarding. That reasoning holds for
 * somebody coming through a vacancy and does not hold for the rest of it. A
 * person joins on Monday, HR has their offer letter in hand, and needing an
 * administrator to type the name in is a queue in front of the one department
 * whose job this is.
 *
 * A separate crud from `staff` above, and deliberately so. That one is built
 * for editing: its beforeSave strips role and password on every save, because
 * HR maintaining a record must not be able to change what somebody may sign in
 * as. Creating needs the opposite — a role and a password are exactly what has
 * to be written — so this uses staffCrudOptions("employee"), the same helper
 * the admin panel creates staff with. Same forced role, same login rule (the
 * mobile number unless another password is typed), same paperwork handling,
 * same refusal of a duplicate email. There is no second definition of what an
 * employee is.
 *
 * Only `create` is taken from it. Reading, editing and deleting stay exactly
 * as they were — and deleting stays absent, because it takes somebody's name
 * off every task and leave they ever touched.
 */
export const newStaff = buildCrud(User, staffCrudOptions("employee"));

/**
 * PUT /api/hr/employees/reporting-line
 *
 * Put several people under one manager, or take them off theirs.
 *
 * A screen of its own writes through this rather than through a PUT per row:
 * moving a team of nine between managers as nine separate requests is nine
 * chances to half-succeed, and no way to tell somebody which four moved.
 *
 * `reportsTo` empty means nobody, the same as it does on an ordinary edit.
 */
export const setReportingLine = async (req, res) => {
  try {
    const ids = Array.isArray(req.body.employees) ? req.body.employees.filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ message: "Choose at least one person" });

    const target = String(req.body.reportsTo || "").trim();

    /**
     * The manager has to be somebody who actually leads. Without this the
     * field would take any user id at all — including the employee's own,
     * which is a person reporting to themselves and a chain that never ends.
     */
    let manager = null;
    if (target) {
      manager = await User.findOne({
        _id: target,
        role: { $in: LEADER_ROLES },
        status: "active",
      }).select("name");

      if (!manager) {
        return res.status(400).json({ message: "That is not somebody who can manage a team" });
      }
      if (ids.some((id) => String(id) === String(manager._id))) {
        return res.status(400).json({ message: "Somebody cannot report to themselves" });
      }
    }

    const result = await User.updateMany(
      { _id: { $in: ids }, role: { $in: STAFF_ROLES } },
      { $set: { reportsTo: manager?._id || null } }
    );

    logActivity(req, {
      action: "updated",
      entity: "Employee",
      message: manager
        ? `${result.modifiedCount} moved under ${manager.name}`
        : `${result.modifiedCount} taken off their manager`,
    });

    return res.status(200).json({
      message: manager
        ? `${result.matchedCount} now report to ${manager.name}`
        : `${result.matchedCount} no longer report to anybody`,
      moved: result.matchedCount,
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ message: "One of those is not a person" });
    }
    console.error("setReportingLine error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/hr/employees/:id/details
 *
 * One person, with the paperwork and the attendance and leave that HR is
 * actually looking them up for.
 */
export const staffDetails = async (req, res) => {
  try {
    const person = await User.findOne({
      _id: req.params.id,
      role: { $in: STAFF_ROLES },
    })
      .select("-password")
      .populate("reportsTo", "name email designation");

    if (!person) return res.status(404).json({ message: "Employee not found" });

    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    /**
     * The workload counts, and only the counts.
     *
     * HR's drawer shows how many projects somebody is on and how much of
     * their work is late, because that is what a review, an incentive and
     * a conversation about somebody's month are made of. It does NOT get
     * the project rows — no client names, no budgets, no scope. The panel's
     * boundary is that nothing under /api/hr answers with a project, and a
     * number is not a project.
     */
    const [leaves, attendanceRows, projects, taskStats] = await Promise.all([
      Leave.find({ employee: person._id })
        .select("type status fromDate toDate days reason decidedByName")
        .sort({ fromDate: -1 })
        .limit(20),
      Attendance.aggregate([
        { $match: { employee: person._id, date: { $gte: monthStart } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      /**
       * On it, or running it.
       *
       * This directory holds operations managers and department heads as well
       * as employees, and a manager is not a member of the projects they own —
       * matching only on `members` would tell HR that somebody running six
       * projects is on none.
       */
      Project.find({
        $or: [{ members: person._id }, { operationsManager: person._id }],
      }).select("status progress"),
      taskRollup({ assignedTo: person._id }),
    ]);

    const attendance = {};
    attendanceRows.forEach((row) => {
      attendance[row._id] = row.count;
    });

    const takenThisYear = await Leave.aggregate([
      { $match: { employee: person._id, status: "approved", fromDate: { $gte: yearStart } } },
      { $group: { _id: null, days: { $sum: "$days" } } },
    ]);

    const item = person.toObject();
    delete item.password;

    return res.status(200).json({
      item,
      leaves,
      attendance,
      /**
       * Which papers are on file, as a list of names rather than the files
       * themselves — the bytes are only served by the document route, one at
       * a time, to somebody who has asked for that one.
       */
      documents: paperworkFiles(person).length,
      stats: {
        ...projectRollup(projects),
        ...taskStats,
        leaveTakenThisYear: takenThisYear[0]?.days || 0,
        presentThisMonth: attendance.present || 0,
        markedThisMonth: Object.values(attendance).reduce((sum, n) => sum + n, 0),
      },
    });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Employee not found" });
    console.error("hr staffDetails error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * PUT /api/hr/employees/:id/documents
 *
 * The onboarding file: the two identity cards, where salary goes, and where
 * they worked before — with the scans that back them up.
 *
 * A multipart request, because it carries files. Everything is merged onto
 * what is already on the record rather than replacing it, which is the whole
 * point of applyStaffPaperwork: HR filling in a bank account weeks after the
 * Aadhaar photo was uploaded must not take the photo off the record.
 *
 * Chasing this paperwork is the job the Documents screen exists for, so the
 * screen can now do it rather than sending somebody to the admin panel.
 */
export const saveStaffPaperwork = async (req, res) => {
  try {
    const person = await User.findOne({
      _id: req.params.id,
      role: { $in: [...STAFF_ROLES, ...HR_PANEL_ROLES] },
    });

    if (!person) return res.status(404).json({ message: "Employee not found" });

    const { data, orphaned } = applyStaffPaperwork(req.body, req, person);

    /**
     * Only the three paperwork sections. A multipart form could carry any
     * field name at all, and this route must not become a second way to
     * change somebody's role, password or status — those are refused here
     * rather than trusted not to be sent.
     */
    ["documents", "bank", "previousEmployment"].forEach((section) => {
      if (data[section] !== undefined) person[section] = data[section];
    });

    await person.save();

    /**
     * The files this save replaced. Removed only once the record is written,
     * so a failed save never takes the old scan with it.
     */
    if (orphaned.length) {
      res.on("finish", () => {
        if (res.statusCode < 400) orphaned.forEach(removeStoredFile);
      });
    }

    logActivity(req, {
      action: "updated",
      entity: "Employee",
      entityId: person._id,
      message: `Paperwork updated for ${person.name}`,
    });

    const item = person.toObject();
    delete item.password;

    return res.status(200).json({ message: "Details saved", item });
  } catch (err) {
    /**
     * applyStaffPaperwork refuses anything that does not look like a real
     * Aadhaar, PAN, IFSC or account number, and it does so by throwing.
     *
     * The admin panel reaches it through buildCrud, which turns that into a
     * 400 with the message on it. This route does not, so without this branch
     * somebody typing eleven digits was told "Server error" rather than "An
     * Aadhaar number is 12 digits" — the one thing that would have helped.
     */
    if (err.name === "InvalidInput") {
      return res.status(400).json({ message: err.message });
    }
    if (err.name === "CastError") return res.status(404).json({ message: "Employee not found" });
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("saveStaffPaperwork error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------- documents */

/** The papers on file for one person, described rather than sent. */
/**
 * Everything the joining form asks for, and where each piece lives.
 *
 * This used to be the seven scans only, which produced the one thing a
 * register must never do: it printed somebody's Aadhaar number in the "on
 * record" column and, in the very next column, said the Aadhaar was still
 * needed. The numbers were collected, stored and displayed — and counted
 * nowhere, so a person who had handed over both their identity numbers still
 * read as 0 of 7.
 *
 * `kind` is what tells a typed number from an uploaded file. They are chased
 * differently — one is a phone call, the other is "send me a photo" — so the
 * screen groups them rather than running them together in one sentence.
 */
const PAPER_FIELDS = [
  ["aadhaarNumber", "Aadhaar number", "number", "Identity"],
  ["aadhaarFront", "Aadhaar — front", "scan", "Identity"],
  ["aadhaarBack", "Aadhaar — back", "scan", "Identity"],
  ["panNumber", "PAN number", "number", "Identity"],
  ["panFront", "PAN — front", "scan", "Identity"],
  ["panBack", "PAN — back", "scan", "Identity"],
  ["resume", "CV / Resume", "scan", "Joining"],
  ["experienceLetter", "Experience letter", "scan", "Previous employer"],
  ["salarySlip", "Salary slip", "scan", "Previous employer"],
  ["relievingLetter", "Relieving letter", "scan", "Previous employer"],
];

/**
 * Is this one piece on file?
 *
 * A typed number counts when it is a non-empty string; a scan counts when
 * there are bytes behind it. findPaperwork only knows about the second, which
 * is why the numbers were invisible to the count.
 */
const hasPaper = (person, field, kind) =>
  kind === "number"
    ? Boolean(String(person.documents?.[field] || "").trim())
    : Boolean(findPaperwork(person, field));

/**
 * GET /api/hr/documents
 *
 * Who has handed in what. The point of the screen is the gaps — the person
 * with no PAN on file is the one HR has to chase — so everybody appears
 * whether or not they have given anything.
 */
export const documentRegister = async (req, res) => {
  try {
    const query = { role: { $in: STAFF_ROLES } };

    const status = String(req.query.status || "").trim();
    if (status && status !== "all") query.status = status;

    const search = String(req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ name: regex }, { email: regex }, { designation: regex }];
    }

    const people = await User.find(query)
      .select("name email role designation department status documents previousEmployment")
      .sort({ name: 1 });

    const rows = people.map((person) => {
      const held = PAPER_FIELDS.filter(([field, , kind]) => hasPaper(person, field, kind));

      return {
        _id: person._id,
        name: person.name,
        email: person.email,
        role: person.role,
        designation: person.designation || "",
        department: person.department || "",
        status: person.status,
        // The numbers are printed on the card and are what a person checks
        // against; the images are only reachable one at a time
        aadhaarNumber: person.documents?.aadhaarNumber || "",
        panNumber: person.documents?.panNumber || "",
        held: held.map(([field, label, kind, group]) => ({ field, label, kind, group })),
        missing: PAPER_FIELDS.filter(([field, , kind]) => !hasPaper(person, field, kind)).map(
          ([field, label, kind, group]) => ({ field, label, kind, group })
        ),
        complete: held.length === PAPER_FIELDS.length,
      };
    });

    return res.status(200).json({
      items: rows,
      total: rows.length,
      fields: PAPER_FIELDS.map(([field, label, kind, group]) => ({ field, label, kind, group })),
      withNothing: rows.filter((row) => row.held.length === 0).length,
      complete: rows.filter((row) => row.complete).length,
    });
  } catch (err) {
    console.error("documentRegister error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/hr/documents/:id/:field
 *
 * One paper, streamed. Nothing under uploads/ is reachable without going
 * through a route, which is what makes this the only way to see somebody's
 * Aadhaar scan — and why it sits behind the HR panel's own auth rather than
 * being a link a browser could follow on its own.
 */
export const serveDocument = async (req, res) => {
  try {
    const person = await User.findOne({
      _id: req.params.id,
      role: { $in: [...STAFF_ROLES, ...HR_PANEL_ROLES] },
    }).select("documents previousEmployment");

    if (!person) return res.status(404).json({ message: "Not found" });

    const file = findPaperwork(person, req.params.field);
    const target = file && storedPath(file.storedName);
    if (!target) return res.status(404).json({ message: "That document is not on file" });

    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    // Shown in a tab rather than pushed to the downloads folder: HR is usually
    // checking a card against a form, not collecting files
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${(file.originalName || req.params.field).replace(/"/g, "")}"`
    );

    const stream = fs.createReadStream(target);
    stream.on("error", (err) => {
      console.error("hr serveDocument stream error:", err.message);
      if (!res.headersSent) res.status(500).json({ message: "Could not read that document" });
    });
    return stream.pipe(res);
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Not found" });
    console.error("serveDocument error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------- reports */

/**
 * GET /api/hr/reports?year=&month=
 *
 * The month HR is asked about: who joined, who left, how attendance went,
 * what leave was taken and what the hiring produced. Counted on read from the
 * collections, so the figures are right on the 3rd rather than on the day
 * somebody remembers to total them up.
 */
export const hrReports = async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;

    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59, 999);

    const [
      headcountRows,
      joined,
      attendanceRows,
      leaveRows,
      leaveByType,
      hired,
      candidateRows,
      teams,
      topAbsent,
    ] = await Promise.all([
      User.aggregate([
        { $match: { role: { $in: [...STAFF_ROLES, ...HR_PANEL_ROLES] } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      User.find({
        role: { $in: [...STAFF_ROLES, ...HR_PANEL_ROLES] },
        joiningDate: { $gte: from, $lte: to },
      })
        .select("name role designation joiningDate")
        .sort({ joiningDate: 1 }),

      Attendance.aggregate([
        { $match: { date: { $gte: from, $lte: to } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      Leave.aggregate([
        { $match: { fromDate: { $lte: to }, toDate: { $gte: from } } },
        { $group: { _id: "$status", count: { $sum: 1 }, days: { $sum: "$days" } } },
      ]),
      Leave.aggregate([
        { $match: { status: "approved", fromDate: { $lte: to }, toDate: { $gte: from } } },
        { $group: { _id: "$type", days: { $sum: "$days" } } },
        { $sort: { days: -1 } },
      ]),

      Candidate.countDocuments({ stage: "hired", hiredAt: { $gte: from, $lte: to } }),
      Candidate.aggregate([{ $group: { _id: "$stage", count: { $sum: 1 } } }]),

      Team.find({ ...ACTIVE_TEAM }).select("name kind members operationsManagers manager"),

      Attendance.aggregate([
        { $match: { date: { $gte: from, $lte: to }, status: "absent" } },
        { $group: { _id: "$employee", days: { $sum: 1 } } },
        { $sort: { days: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const headcount = {};
    headcountRows.forEach((row) => {
      headcount[row._id] = row.count;
    });

    const attendance = {};
    attendanceRows.forEach((row) => {
      attendance[row._id] = row.count;
    });
    const marked = Object.values(attendance).reduce((sum, n) => sum + n, 0);
    const present = (attendance.present || 0) + (attendance.half_day || 0) * 0.5;

    const leave = {};
    leaveRows.forEach((row) => {
      leave[row._id] = { count: row.count, days: row.days };
    });

    const pipeline = {};
    candidateRows.forEach((row) => {
      pipeline[row._id] = row.count;
    });

    // Names for the absence list, resolved in one query rather than per row
    const absentIds = topAbsent.map((row) => row._id).filter(Boolean);
    const absentPeople = await User.find({ _id: { $in: absentIds } }).select("name designation");
    const nameById = new Map(absentPeople.map((p) => [String(p._id), p]));

    return res.status(200).json({
      period: { year, month },
      headcount: {
        active: headcount.active || 0,
        inactive: headcount.inactive || 0,
        total: Object.values(headcount).reduce((sum, n) => sum + n, 0),
      },
      joiners: joined,
      attendance: {
        counts: attendance,
        marked,
        rate: marked ? Math.round((present / marked) * 100) : 0,
      },
      leave: {
        byStatus: leave,
        byType: leaveByType.map((row) => ({ type: row._id, days: row.days })),
        approvedDays: leave.approved?.days || 0,
        pending: leave.pending?.count || 0,
      },
      recruitment: { hired, pipeline },
      teams: teams.map((team) => ({
        _id: team._id,
        name: team.name,
        kind: team.kind,
        size: team.everyone().length,
      })),
      mostAbsent: topAbsent.map((row) => ({
        _id: row._id,
        name: nameById.get(String(row._id))?.name || "Someone no longer on record",
        designation: nameById.get(String(row._id))?.designation || "",
        days: row.days,
      })),
    });
  } catch (err) {
    console.error("hrReports error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
