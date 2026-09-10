// Two things HR asked for, and one that was quietly wrong underneath them.
//
// The incentive tallies used to be produced by running /on time/ over the
// English sentence that explains a task's score, and work with no due date was
// counted into the on-time column — so a month where nobody set a deadline
// reported 100% on time. Both are checked here against tasks with known dates.
//
// The second half is HR opening a department, which used to need an admin.
import mongoose from "mongoose";
import dotenv from "dotenv";

import IncentiveRule from "./models/IncentiveRule.js";
import Task from "./models/Task.js";
import Team from "./models/Team.js";
import User from "./models/User.js";
import { hashPassword } from "./utils/password.js";
import { scoreEmployee } from "./utils/incentive.js";

dotenv.config();

const PORT = process.env.PORT_UNDER_TEST || process.env.PORT || 5002;
const BASE = `http://localhost:${PORT}/api`;

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};

const json = async (token, method, route, body) => {
  const res = await fetch(BASE + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
};

const PASSWORD = "hr-incentive-test-pass";
const HR_EMAIL = "hrtest.head@example.com";
const EMP_EMAIL = "hrtest.employee@example.com";
const EMAILS = [HR_EMAIL, EMP_EMAIL];
const DEPT_NAME = "Test Department (automated)";

/** A date inside the period under test. */
const PERIOD = "2024-06";
const day = (n) => new Date(2024, 5, n, 12, 0, 0);

const cleanup = async () => {
  const users = await User.find({ email: { $in: EMAILS } }).select("_id");
  await Task.deleteMany({ assignedTo: { $in: users.map((u) => u._id) } });
  await User.deleteMany({ email: { $in: EMAILS } });
  await Team.deleteMany({ name: DEPT_NAME });
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await cleanup();

  const hr = await User.create({
    name: "HR Head Test",
    email: HR_EMAIL,
    password: hashPassword(PASSWORD),
    role: "hr",
    status: "active",
  });
  const employee = await User.create({
    name: "Scored Employee",
    email: EMP_EMAIL,
    password: hashPassword(PASSWORD),
    role: "employee",
    status: "active",
  });

  const rule = await IncentiveRule.current();

  /* ------------------------------------------------------ a known month */

  /**
   * Task.js stamps completedAt from the status in a pre-save hook, so a
   * completion date cannot be set on the create — it would be overwritten with
   * "now" and the task would land in this month rather than the one under
   * test. Written afterwards with updateOne, which the hook does not see.
   */
  const completed = async (title, dueDate, completedAt) => {
    const task = await Task.create({
      title,
      assignedTo: employee._id,
      status: "completed",
      ...(dueDate ? { dueDate } : {}),
    });
    await Task.updateOne({ _id: task._id }, { $set: { completedAt } });
    return task;
  };

  // Done on the day it was due
  await completed("On time task", day(10), day(10));
  // Done three days after it was due
  await completed("Late task", day(10), day(13));
  // Finished, but nobody ever agreed a date
  await completed("Undated task", null, day(12));
  // Still open, and the month is long gone
  await Task.create({
    title: "Overdue task",
    assignedTo: employee._id,
    status: "pending",
    dueDate: day(20),
  });

  console.log("\nHow the month is counted");

  const score = await scoreEmployee(employee._id, PERIOD, rule);

  check("one task counted as on time", score.counts.completedOnTime === 1, String(score.counts.completedOnTime));
  check("one counted as late", score.counts.completedLate === 1, String(score.counts.completedLate));
  check(
    "the undated one is counted apart, not as punctual",
    score.counts.completedNoDate === 1,
    String(score.counts.completedNoDate)
  );
  check("one counted as overdue", score.counts.overdue === 1, String(score.counts.overdue));
  check("three finished in total", score.counts.completed === 3, String(score.counts.completed));

  /**
   * One of three tasks that had a date was delivered on it. Counting the
   * undated one as a success would have made this 66%.
   */
  check("the on-time rate leaves undated work out", score.counts.onTimeRate === 33, `${score.counts.onTimeRate}%`);

  const timings = Object.fromEntries(score.lines.map((l) => [l.title, l]));
  check("the on-time line says so as a field, not only in prose", timings["On time task"].onTime === true);
  check("the late line carries the number of days", timings["Late task"].lateDays === 3, String(timings["Late task"].lateDays));
  check("the undated line is neither on time nor late", timings["Undated task"].onTime === null);

  /* ------------------------------------- the quality bonus needs a rating */

  console.log("\nThe quality bonus");

  const zeroMin = { ...rule.toObject(), qualityMinRating: 0, qualityBonus: 3 };
  const unrated = await Task.findOne({ assignedTo: employee._id, title: "On time task" });
  const withZeroMin = await scoreEmployee(employee._id, PERIOD, zeroMin);
  const unratedLine = withZeroMin.lines.find((l) => String(l._id) === String(unrated._id));
  check(
    "an unreviewed task earns no quality bonus even at a zero minimum",
    !/rated/.test(unratedLine.why),
    unratedLine.why
  );

  // Written with updateOne for the same reason as above — a document save
  // would re-run the status hook and move completedAt to now.
  await Task.updateOne({ _id: unrated._id }, { $set: { reviewRating: 4 } });
  const rated = await scoreEmployee(employee._id, PERIOD, rule);
  const ratedLine = rated.lines.find((l) => String(l._id) === String(unrated._id));
  check("a reviewed task does earn it", /rated 4\/5/.test(ratedLine.why), ratedLine.why);

  /* ------------------------------------------------ what HR reads on screen */

  console.log("\nThe HR incentives screen");

  const token = (await json(null, "POST", "/hr/login", { email: HR_EMAIL, password: PASSWORD }))
    .data?.token;
  check("HR can sign in", Boolean(token));

  const list = await json(token, "GET", `/hr/incentives?period=${PERIOD}`);
  check("the month loads", list.status === 200, list.data?.message);

  const row = (list.data?.items || []).find((i) => i.employee.email === EMP_EMAIL);
  check("the employee is on it", Boolean(row));
  check("the row carries the unfloored figure", row?.raw !== undefined);
  check("and whether the floor bit", row?.floored !== undefined);
  check("the row counts undated work apart", row?.counts?.completedNoDate === 1);

  check("the totals say how many earned a bonus", list.data?.totals?.earning !== undefined);
  check("and the on-time rate is a rate, not a raw count", list.data?.totals?.onTimeRate !== undefined);
  check("a separate list says who is being paid", Array.isArray(list.data?.earners));

  const earnerEmails = (list.data?.earners || []).map((e) => e.employee.email);
  const earnedHere = (row?.bonus?.amount || 0) > 0;
  check(
    "the payout list agrees with the table",
    earnedHere === earnerEmails.includes(EMP_EMAIL),
    earnedHere ? "earned, and listed" : "earned nothing, and not listed"
  );

  /* -------------------------------------------------- HR opens a department */

  console.log("\nHR opening a department");

  const before = await json(token, "GET", "/hr/departments");
  check("HR can read the department list", before.status === 200, before.data?.message);

  const created = await json(token, "POST", "/hr/departments", {
    name: DEPT_NAME,
    kind: "marketing",
    description: "Opened by an automated test",
  });
  check("HR can open one", created.status === 201, created.data?.message);
  check("it is stored with the kind that was chosen", created.data?.item?.kind === "marketing");

  const stored = await Team.findOne({ name: DEPT_NAME });
  check("it exists as a real team record", Boolean(stored));
  check("and remembers who opened it", String(stored?.createdBy) === String(hr._id));
  check("with no manager, so it shows as a gap to staff", !stored?.manager);

  const renamed = await json(token, "PUT", `/hr/departments/${stored._id}`, {
    description: "Corrected by the test",
  });
  check("HR can correct one", renamed.status === 200);

  const deleted = await json(token, "DELETE", `/hr/departments/${stored._id}`);
  check(
    "HR cannot delete one — that stays an administrator's call",
    deleted.status === 403 || deleted.status === 404,
    `${deleted.status} ${deleted.data?.message || ""}`
  );

  const org = await json(token, "GET", "/hr/reports/org");
  const gapNames = org.data?.gaps?.teamsWithoutManager || [];
  check("the new department is listed as needing a manager", gapNames.includes(DEPT_NAME));

  /* ------------------------------------------- the attendance sheet's times */

  console.log("\nAttendance without in and out times");

  const today = new Date().toISOString().slice(0, 10);
  await json(token, "POST", "/hr/attendance", {
    date: today,
    entries: [{ employee: String(employee._id), status: "present", checkIn: "09:30", checkOut: "18:30" }],
  });

  // The sheet no longer sends times at all. The stored ones must survive it.
  const resaved = await json(token, "POST", "/hr/attendance", {
    date: today,
    entries: [{ employee: String(employee._id), status: "half_day", note: "left early" }],
  });
  check("attendance saves without any times", resaved.status === 200, resaved.data?.message);

  const sheet = await json(token, "GET", `/hr/attendance?date=${today}`);
  const mark = (sheet.data?.items || []).find((i) => String(i.employee.id) === String(employee._id));
  check("the status was updated", mark?.status === "half_day");
  check("and the times already recorded were not wiped", mark?.checkIn === "09:30", mark?.checkIn);

  await cleanup();
  await mongoose.disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch(async (err) => {
  console.error("test run failed:", err);
  try {
    await cleanup();
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
