/**
 * Wages, counted off the attendance sheet.
 *
 * The arithmetic is the whole feature, so it is checked against a month whose
 * every day this file wrote itself: so many present, so many half, one paid
 * leave, one unpaid, one absent. If the total is right for that, it is right.
 *
 * The second thing being proved is that nothing is banked — correcting an
 * attendance mark has to move the wage bill on the next read, with nobody
 * recalculating anything.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";

import Attendance from "./models/Attendance.js";
import Leave from "./models/Leave.js";
import LeavePolicy from "./models/LeavePolicy.js";
import SalaryPayment from "./models/SalaryPayment.js";
import User from "./models/User.js";
import { hashPassword } from "./utils/password.js";

dotenv.config();

const PORT = process.env.PORT_UNDER_TEST || process.env.PORT || 5002;
const BASE = `http://localhost:${PORT}/api`;

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};
const section = (name) => console.log(`\n▸ ${name}`);

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

const signIn = async (email, password) =>
  (await json(null, "POST", "/auth/login", { email, password })).data?.token;

const EMP_EMAIL = "salary.probe@example.com";
const HR_EMAIL = "salary.hr@example.com";
const OM_EMAIL = "salary.opsmanager@example.com";
const PASSWORD = "salary-test-pass-123";
const RATE = 300;

/** A month safely in the past so "today" never moves the answer. */
const YEAR = 2025;
const MONTH = 3;
const day = (n) => new Date(YEAR, MONTH - 1, n, 12, 0, 0);

const UNPAID_TYPE = "unpaid";

const cleanup = async () => {
  const staff = await User.find({ email: { $in: [EMP_EMAIL, HR_EMAIL, OM_EMAIL] } }).select("_id");
  const ids = staff.map((s) => s._id);
  await Attendance.deleteMany({ employee: { $in: ids } });
  await Leave.deleteMany({ employee: { $in: ids } });
  await SalaryPayment.deleteMany({ employee: { $in: ids } });
  await User.deleteMany({ _id: { $in: ids } });
  await LeavePolicy.deleteMany({ name: "Salary probe unpaid" });
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await cleanup();

  const employee = await User.create({
    name: "Salary Probe",
    email: EMP_EMAIL,
    password: hashPassword(PASSWORD),
    role: "employee",
    status: "active",
  });
  await User.create({
    name: "Salary HR",
    email: HR_EMAIL,
    password: hashPassword(PASSWORD),
    role: "hr",
    status: "active",
  });
  await User.create({
    name: "Salary Ops Manager",
    email: OM_EMAIL,
    password: hashPassword(PASSWORD),
    role: "operations_manager",
    status: "active",
  });

  /**
   * An unpaid policy, so one leave day is worth nothing and another is worth
   * a full day. Without this both would count the same and the test would not
   * prove the rule it exists to prove.
   */
  const unpaidPolicy = await LeavePolicy.findOne({ type: UNPAID_TYPE });
  if (!unpaidPolicy) {
    await LeavePolicy.create({
      name: "Salary probe unpaid",
      type: UNPAID_TYPE,
      paid: false,
      active: true,
    });
  } else if (unpaidPolicy.paid !== false) {
    await LeavePolicy.updateOne({ _id: unpaidPolicy._id }, { $set: { paid: false } });
  }

  /* -------------------------------------------------- a month we control */

  //  6 present  ·  2 half days  ·  1 paid leave  ·  1 unpaid leave  ·  2 absent
  const marks = [
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ date: day(n), status: "present" })),
    ...[10, 11].map((n) => ({ date: day(n), status: "half_day" })),
    { date: day(14), status: "leave" },
    { date: day(15), status: "leave" },
    ...[20, 21].map((n) => ({ date: day(n), status: "absent" })),
  ];
  await Attendance.insertMany(
    marks.map((m) => ({ ...m, employee: employee._id, date: new Date(m.date.setHours(0, 0, 0, 0)) }))
  );

  // The 14th is casual (paid); the 15th is the unpaid type
  await Leave.create({
    employee: employee._id,
    type: "casual",
    status: "approved",
    fromDate: day(14),
    toDate: day(14),
    days: 1,
  });
  await Leave.create({
    employee: employee._id,
    type: UNPAID_TYPE,
    status: "approved",
    fromDate: day(15),
    toDate: day(15),
    days: 1,
  });

  const admin = await signIn(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const hr = await signIn(HR_EMAIL, PASSWORD);
  const om = await signIn(OM_EMAIL, PASSWORD);
  const emp = await signIn(EMP_EMAIL, PASSWORD);
  check("everybody signs in", Boolean(admin && hr && om && emp));

  /* ------------------------------------------------------------ the rate */

  section("The daily rate");

  const before = await json(admin, "GET", `/admin/staff/${employee._id}/salary`);
  check("salary loads before a rate is set", before.status === 200, before.data?.message);
  check("and says plainly that no rate is set", before.data?.rateSet === false);

  const setRate = await json(admin, "PUT", `/admin/staff/${employee._id}/salary/rate`, {
    dailyRate: RATE,
  });
  check("admin sets a daily rate", setRate.status === 200, setRate.data?.message);

  const negative = await json(admin, "PUT", `/admin/staff/${employee._id}/salary/rate`, {
    dailyRate: -5,
  });
  check("a negative rate is refused", negative.status === 400, negative.data?.message);

  /* ------------------------------------------------------ the arithmetic */

  section("What the month is worth");

  const r = await json(admin, "GET", `/admin/staff/${employee._id}/salary?year=${YEAR}&month=${MONTH}`);
  const m = r.data?.month;

  check("the month loads", r.status === 200);
  check("every marked day is counted", m?.marked === 12, `${m?.marked} of 12`);

  /**
   * 6 present + 2 half (=1) + 1 paid leave + 0 for the unpaid one + 0 absent
   * = 8 payable days.
   */
  check("payable days add up", m?.payableDays === 8, `${m?.payableDays} (expected 8)`);
  check(`earned = 8 × ₹${RATE}`, m?.earned === 8 * RATE, `₹${m?.earned}`);

  const paidLeaveDay = m?.days.find((d) => d.status === "leave" && d.paidLeave);
  const unpaidLeaveDay = m?.days.find((d) => d.status === "leave" && d.paidLeave === false);
  check("paid leave is worth a full day", paidLeaveDay?.amount === RATE, `₹${paidLeaveDay?.amount}`);
  check("unpaid leave is worth nothing", unpaidLeaveDay?.amount === 0, `₹${unpaidLeaveDay?.amount}`);

  const half = m?.days.find((d) => d.status === "half_day");
  check("a half day is worth half", half?.amount === RATE / 2, `₹${half?.amount}`);

  const absent = m?.days.find((d) => d.status === "absent");
  check("an absent day is worth nothing", absent?.amount === 0);

  check("the working is returned day by day", m?.days.length === 12, `${m?.days.length} rows`);

  /* ------------------------------- nothing is banked: fix a day, pay moves */

  section("Correcting a day moves the wage bill");

  await Attendance.updateOne(
    { employee: employee._id, date: new Date(new Date(day(20)).setHours(0, 0, 0, 0)) },
    { $set: { status: "present" } }
  );

  const after = await json(admin, "GET", `/admin/staff/${employee._id}/salary?year=${YEAR}&month=${MONTH}`);
  check(
    "an absent day corrected to present adds a day's pay, with no recalculation",
    after.data?.month?.earned === 9 * RATE,
    `₹${after.data?.month?.earned} (was ₹${8 * RATE})`
  );

  /* ---------------------------------------------------------- payments */

  section("What has actually been handed over");

  const p1 = await json(admin, "POST", `/admin/staff/${employee._id}/salary/payments`, {
    amount: 1500,
    paidOn: day(18).toISOString(),
    mode: "upi",
    reference: "UTRPROBE1",
  });
  check("a payment is recorded", p1.status === 201, p1.data?.message);

  const zero = await json(admin, "POST", `/admin/staff/${employee._id}/salary/payments`, {
    amount: 0,
  });
  check("a zero payment is refused", zero.status === 400, zero.data?.message);

  const withPay = await json(
    admin,
    "GET",
    `/admin/staff/${employee._id}/salary?year=${YEAR}&month=${MONTH}`
  );
  check("paid this month", withPay.data?.month?.paid === 1500, `₹${withPay.data?.month?.paid}`);
  check(
    "still owed this month",
    withPay.data?.month?.due === 9 * RATE - 1500,
    `₹${withPay.data?.month?.due}`
  );
  check("paid all time", withPay.data?.lifetime?.paid === 1500, `₹${withPay.data?.lifetime?.paid}`);
  check("the payment shows its reference", withPay.data?.payments?.[0]?.reference === "UTRPROBE1");
  check("and who recorded it", Boolean(withPay.data?.payments?.[0]?.recordedByName));

  const paymentId = p1.data?.item?._id;
  const gone = await json(
    admin,
    "DELETE",
    `/admin/staff/${employee._id}/salary/payments/${paymentId}`
  );
  check("a mistaken entry can be removed", gone.status === 200, gone.data?.message);

  const afterRemove = await json(
    admin,
    "GET",
    `/admin/staff/${employee._id}/salary?year=${YEAR}&month=${MONTH}`
  );
  check("and the amount goes back to owed", afterRemove.data?.month?.paid === 0);

  /* ---------------------------------------------------------- who may look */

  section("Who may see what somebody is paid");

  const hrSees = await json(hr, "GET", `/hr/staff/${employee._id}/salary`);
  check("HR can — payroll is theirs", hrSees.status === 200, String(hrSees.status));

  const hrPays = await json(hr, "POST", `/hr/staff/${employee._id}/salary/payments`, {
    amount: 500,
    reference: "HRPROBE",
  });
  check("HR can record a payment", hrPays.status === 201, hrPays.data?.message);
  if (hrPays.data?.item?._id) {
    await json(hr, "DELETE", `/hr/staff/${employee._id}/salary/payments/${hrPays.data.item._id}`);
  }

  for (const [who, token, route] of [
    ["an operations manager", om, `/leader/staff/${employee._id}/salary`],
    ["the employee themselves", emp, `/employee/staff/${employee._id}/salary`],
    ["an operations manager on the admin route", om, `/admin/staff/${employee._id}/salary`],
    ["the employee on the HR route", emp, `/hr/staff/${employee._id}/salary`],
  ]) {
    const r2 = await json(token, "GET", route);
    check(`${who} cannot`, r2.status === 401 || r2.status === 403 || r2.status === 404, String(r2.status));
  }

  const noToken = await json(null, "GET", `/admin/staff/${employee._id}/salary`);
  check("and neither can anybody without a token", noToken.status === 401, String(noToken.status));

  await cleanup();
  await mongoose.disconnect();

  console.log(`\n${"─".repeat(58)}\n  ${pass} passed, ${fail} failed\n${"─".repeat(58)}`);
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
