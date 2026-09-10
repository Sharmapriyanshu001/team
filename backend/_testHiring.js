// The Hiring section, end to end.
//
//   Job Opening → Candidate → Interview → Shortlisted → Selected
//                                                          ↓
//                                       Employee ← Onboarding
//
// Every link is walked as HR would walk it, and the things that must NOT be
// possible are attempted: skipping to hired, hiring into a department role,
// and reaching hiring at all from another panel.
//
// Run against a server started on PORT_UNDER_TEST (default 5099). Everything
// it creates is removed at the end, including on failure.
import dotenv from "dotenv";
import mongoose from "mongoose";

import Candidate from "./models/Candidate.js";
import JobOpening from "./models/JobOpening.js";
import User from "./models/User.js";

dotenv.config();

const PORT = process.env.PORT_UNDER_TEST || 5099;
const BASE = `http://localhost:${PORT}/api`;

let pass = 0;
let fail = 0;
const failures = [];

const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (ok) pass += 1;
  else {
    fail += 1;
    failures.push(`${label}${detail ? " — " + detail : ""}`);
  }
};

const call = async (token, method, route, body) => {
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
  } catch {
    data = null;
  }
  return { status: res.status, data };
};

const TAG = `hire_${Date.now()}`;
const made = { users: [], candidates: [], openings: [] };

const cleanup = async () => {
  await Promise.all([
    User.deleteMany({ _id: { $in: made.users } }),
    Candidate.deleteMany({ _id: { $in: made.candidates } }),
    JobOpening.deleteMany({ _id: { $in: made.openings } }),
  ]);
  await Promise.all([
    User.deleteMany({ email: new RegExp(TAG) }),
    Candidate.deleteMany({ email: new RegExp(TAG) }),
    JobOpening.deleteMany({ title: new RegExp(TAG) }),
  ]);
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  /* ------------------------------------------------------------ sign in */

  console.log("\n▸ Setting up");

  const adminLogin = await call(null, "POST", "/admin/login", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  if (adminLogin.status !== 200) throw new Error("cannot continue without an admin token");
  const admin = adminLogin.data.token;

  const madeHead = await call(admin, "POST", "/admin/department-accounts", {
    name: "Hiring Test Head",
    email: `head.${TAG}@example.com`,
    role: "hr",
    phone: "9600000001",
  });
  check("an HR head exists to run hiring", madeHead.status === 201, madeHead.data?.message);
  if (madeHead.status !== 201) throw new Error("no HR head");
  made.users.push(madeHead.data.item._id);

  const hrLogin = await call(null, "POST", "/hr/login", {
    email: madeHead.data.credentials.loginId,
    password: madeHead.data.credentials.password,
  });
  const hr = hrLogin.data?.token;
  check("they sign in to the HR panel", hrLogin.status === 200, hrLogin.data?.message);
  check("and hold the hiring module", Array.isArray(hrLogin.data?.access?.modules?.hiring));

  /* ------------------------------------------------------- 1. the opening */

  console.log("\n▸ 1. Job Opening");

  const opening = await call(hr, "POST", "/hr/hiring/openings", {
    title: `React Developer ${TAG}`,
    department: "Engineering",
    location: "Jaipur",
    positions: 2,
    experience: "2-4 years",
    salaryMin: 400000,
    salaryMax: 700000,
    skills: "React, Node",
    targetDate: "2032-12-31",
  });
  check("HR creates a job opening", opening.status === 201, opening.data?.message);
  if (opening.status !== 201) throw new Error("no opening to hang the pipeline off");
  made.openings.push(opening.data.item._id);

  const openingId = opening.data.item._id;
  check("it is given a readable code", Boolean(opening.data.item.code), opening.data.item.code);
  check("and opens for two seats", opening.data.item.positions === 2);

  const badBand = await call(hr, "POST", "/hr/hiring/openings", {
    title: `Bad band ${TAG}`,
    salaryMin: 900000,
    salaryMax: 100000,
  });
  check("a salary band the wrong way round is refused", badBand.status === 400, badBand.data?.message);

  const noSeats = await call(hr, "POST", "/hr/hiring/openings", {
    title: `No seats ${TAG}`,
    positions: 0,
  });
  check("an opening for zero people is refused", noSeats.status === 400, noSeats.data?.message);

  /* ----------------------------------------------------- 2. the candidate */

  console.log("\n▸ 2. Candidate");

  const candidate = await call(hr, "POST", "/hr/candidates", {
    name: `Pipeline Person ${TAG}`,
    email: `cand.${TAG}@example.com`,
    phone: "9600000002",
    position: "React Developer",
    source: "referral",
    jobOpening: openingId,
  });
  check("a candidate applies against the opening", candidate.status === 201, candidate.data?.message);
  if (candidate.status !== 201) throw new Error("no candidate");
  made.candidates.push(candidate.data.item._id);

  const candidateId = candidate.data.item._id;
  check(
    "and is linked to the vacancy",
    String(candidate.data.item.jobOpening) === String(openingId)
  );

  const detail = await call(hr, "GET", `/hr/hiring/openings/${openingId}/detail`);
  check("the opening now shows them in its pipeline", detail.data?.stats?.applicants === 1);
  check("with two seats still to fill", detail.data?.stats?.remaining === 2);

  /* ---------------------------------------------------- 3. the interview */

  console.log("\n▸ 3. Interview");

  const round = await call(hr, "POST", `/hr/candidates/${candidateId}/interviews`, {
    round: "Technical",
    scheduledAt: "2032-06-01T10:00:00.000Z",
    mode: "online",
  });
  check("a round is scheduled", round.status === 201, round.data?.message);
  check("scheduling moves them to interview", round.data?.item?.stage === "interview");

  const schedule = await call(hr, "GET", "/hr/hiring/interviews?when=upcoming");
  const mine = schedule.data?.items?.find((r) => String(r.candidateId) === String(candidateId));
  check("it appears on the interview schedule", Boolean(mine), `${schedule.data?.total} rounds`);
  check("carrying the opening it belongs to", mine?.opening?._id === String(openingId));

  const written = await call(
    hr,
    "PUT",
    `/hr/candidates/${candidateId}/interviews/${mine._id}`,
    { outcome: "passed", rating: 4, feedback: "Strong on React" }
  );
  check("the round is written up", written.status === 200, written.data?.message);

  /* --------------------------------------------------- 4. the decisions */

  console.log("\n▸ 4. Shortlisted → Selected");

  const short = await call(hr, "PUT", `/hr/hiring/candidates/${candidateId}/stage`, {
    stage: "shortlisted",
  });
  check("they are shortlisted", short.status === 200, short.data?.message);
  check("and the date is stamped", Boolean(short.data?.item?.shortlistedAt));

  const shortlist = await call(hr, "GET", "/hr/candidates?stage=shortlisted&limit=200");
  check(
    "they show on the Shortlisted list",
    shortlist.data?.items?.some((c) => String(c._id) === String(candidateId))
  );

  const selected = await call(hr, "PUT", `/hr/hiring/candidates/${candidateId}/stage`, {
    stage: "selected",
  });
  check("they are selected", selected.status === 200, selected.data?.message);
  check("the date is stamped", Boolean(selected.data?.item?.selectedAt));
  check(
    "the shortlist date SURVIVES the move — time-to-hire is measured from it",
    Boolean(selected.data?.item?.shortlistedAt)
  );
  check(
    "and selecting opens their onboarding checklist",
    (selected.data?.item?.onboarding?.checklist?.length || 0) > 0,
    `${selected.data?.item?.onboarding?.checklist?.length} items`
  );

  /* --------------------------------------- what must NOT be possible */

  console.log("\n▸ What the flow refuses");

  const skip = await call(hr, "PUT", `/hr/hiring/candidates/${candidateId}/stage`, {
    stage: "hired",
  });
  check(
    "you cannot skip to hired — onboarding creates the account",
    skip.status === 400,
    skip.data?.message
  );

  const junk = await call(hr, "PUT", `/hr/hiring/candidates/${candidateId}/stage`, {
    stage: "promoted",
  });
  check("an invented stage is refused", junk.status === 400, junk.data?.message);

  const editHired = await call(hr, "PUT", `/hr/candidates/${candidateId}`, { stage: "hired" });
  check(
    "and the edit form still cannot mark somebody hired",
    editHired.status === 400,
    editHired.data?.message
  );

  /* ------------------------------------------------------ 5. onboarding */

  console.log("\n▸ 5. Onboarding → Employee");

  const board = await call(hr, "GET", "/hr/hiring/onboarding");
  const row = board.data?.items?.find((r) => String(r._id) === String(candidateId));
  check("they appear on the onboarding board", Boolean(row));
  check("not yet complete", row?.complete === false);
  check("with a checklist to work through", row?.checklistTotal > 0);

  const ticked = await call(hr, "PUT", `/hr/hiring/onboarding/${candidateId}`, {
    joiningDate: "2032-07-01",
    designation: "React Developer",
    department: "Engineering",
    checklist: row.onboarding.checklist.map((item, i) => ({ label: item.label, done: i < 2 })),
  });
  check("the joining details and checklist save", ticked.status === 200, ticked.data?.message);

  const progressed = await call(hr, "GET", "/hr/hiring/onboarding");
  const after = progressed.data?.items?.find((r) => String(r._id) === String(candidateId));
  check("progress is counted from the ticks", after?.checklistDone === 2, `${after?.checklistDone}`);

  const escalate = await call(hr, "POST", `/hr/candidates/${candidateId}/hire`, { role: "hr" });
  check(
    "onboarding cannot mint a department login",
    escalate.status === 403,
    escalate.data?.message
  );

  const hired = await call(hr, "POST", `/hr/candidates/${candidateId}/hire`, {});
  check("completing onboarding creates the employee", hired.status === 201, hired.data?.message);
  check("and hands back the login", Boolean(hired.data?.credentials?.password));
  if (hired.status === 201) made.users.push(hired.data.user._id);

  const employee = await User.findById(hired.data.user._id);
  check(
    "the joining date agreed at onboarding is used",
    employee?.joiningDate?.toISOString().startsWith("2032-07-01"),
    employee?.joiningDate?.toISOString()
  );
  check("as is the designation", employee?.designation === "React Developer");

  const done = await call(hr, "GET", "/hr/hiring/onboarding");
  const final = done.data?.items?.find((r) => String(r._id) === String(candidateId));
  check("the board marks them complete", final?.complete === true);

  const staff = await call(hr, "GET", `/hr/employees?search=${encodeURIComponent(TAG)}`);
  check(
    "and they now appear under Employees",
    staff.data?.items?.some((e) => String(e._id) === String(hired.data.user._id))
  );

  /* -------------------------------------------------- the opening closes */

  console.log("\n▸ The opening");

  const afterOne = await call(hr, "GET", `/hr/hiring/openings/${openingId}/detail`);
  check("one of two seats is filled", afterOne.data?.stats?.hired === 1);
  check("one still to go", afterOne.data?.stats?.remaining === 1);
  check(
    "so the opening stays open",
    afterOne.data?.item?.status === "open",
    afterOne.data?.item?.status
  );

  // The second hire should close it
  const second = await call(hr, "POST", "/hr/candidates", {
    name: `Second Hire ${TAG}`,
    email: `cand2.${TAG}@example.com`,
    phone: "9600000003",
    jobOpening: openingId,
  });
  made.candidates.push(second.data.item._id);
  await call(hr, "PUT", `/hr/hiring/candidates/${second.data.item._id}/stage`, {
    stage: "shortlisted",
  });
  await call(hr, "PUT", `/hr/hiring/candidates/${second.data.item._id}/stage`, {
    stage: "selected",
  });
  const secondHire = await call(hr, "POST", `/hr/candidates/${second.data.item._id}/hire`, {});
  if (secondHire.status === 201) made.users.push(secondHire.data.user._id);

  const afterTwo = await call(hr, "GET", `/hr/hiring/openings/${openingId}/detail`);
  check("both seats filled", afterTwo.data?.stats?.hired === 2);
  check(
    "and the opening closes itself",
    afterTwo.data?.item?.status === "filled",
    afterTwo.data?.item?.status
  );

  /* ------------------------------------------------------- the rejected */

  console.log("\n▸ Rejected, and reopened");

  const third = await call(hr, "POST", "/hr/candidates", {
    name: `Turned Down ${TAG}`,
    email: `cand3.${TAG}@example.com`,
    phone: "9600000004",
  });
  made.candidates.push(third.data.item._id);
  const thirdId = third.data.item._id;

  const rejected = await call(hr, "PUT", `/hr/hiring/candidates/${thirdId}/stage`, {
    stage: "rejected",
    reason: "Asked above the band",
  });
  check("a candidate can be turned down", rejected.status === 200, rejected.data?.message);
  check("with the reason kept", rejected.data?.item?.rejectionReason === "Asked above the band");
  check("and the date stamped", Boolean(rejected.data?.item?.rejectedAt));

  const reopened = await call(hr, "PUT", `/hr/hiring/candidates/${thirdId}/stage`, {
    stage: "screening",
  });
  check("and put back in the pipeline later", reopened.status === 200, reopened.data?.message);
  check("which clears the rejection date", !reopened.data?.item?.rejectedAt);

  /* ---------------------------------------------------------- the board */

  console.log("\n▸ The board");

  const dash = await call(hr, "GET", "/hr/hiring/dashboard");
  check("the hiring dashboard answers", dash.status === 200);
  check(
    "with a funnel, openings, sources and a schedule",
    ["funnel", "openings", "sources", "upcoming", "stats"].every(
      (key) => dash.data?.[key] !== undefined
    )
  );
  check("counting the hires this month", (dash.data?.stats?.hiredThisMonth || 0) >= 2);
  check(
    "and a median time to hire",
    dash.data?.stats?.medianDaysToHire !== undefined,
    `${dash.data?.stats?.medianDaysToHire} days`
  );
  check(
    "source effectiveness is a rate, not a raw count",
    dash.data?.sources?.every((s) => typeof s.rate === "number")
  );

  const lookups = await call(hr, "GET", "/hr/hiring/lookups");
  check("the forms get their openings and staff", lookups.status === 200);
  check(
    "and a filled opening is no longer offered",
    !lookups.data?.openings?.some((o) => String(o._id) === String(openingId))
  );

  /* ----------------------------------------------------- the boundaries */

  console.log("\n▸ Hiring is HR's alone");

  for (const route of [
    "/admin/hr/hiring/dashboard",
    "/admin/hiring/openings",
    "/admin/hr/hiring/openings",
  ]) {
    const res = await call(admin, "GET", route);
    check(`${route} is not an admin route`, res.status === 404, `HTTP ${res.status}`);
  }
  check(
    "an admin token cannot reach the HR hiring board",
    (await call(admin, "GET", "/hr/hiring/dashboard")).status === 403
  );

  /* ------------------------------------------------ nothing else changed */

  console.log("\n▸ The rest of the panel is untouched");

  for (const route of [
    "/hr/dashboard",
    "/hr/employees",
    "/hr/leaves",
    "/hr/attendance/summary",
    "/hr/documents",
    "/hr/reports",
    "/hr/candidates",
  ]) {
    const res = await call(hr, "GET", route);
    check(`HR GET ${route}`, res.status === 200, res.status === 200 ? "" : `HTTP ${res.status}`);
  }
  for (const route of ["/admin/hr/candidates", "/admin/hr/overview", "/admin/dashboard"]) {
    const res = await call(admin, "GET", route);
    check(`admin GET ${route}`, res.status === 200, res.status === 200 ? "" : `HTTP ${res.status}`);
  }
};

run()
  .catch((err) => {
    console.error("\n💥 " + (err?.stack || err));
    fail += 1;
    failures.push(`threw: ${err?.message}`);
  })
  .finally(async () => {
    await cleanup().catch((err) => console.error("cleanup:", err.message));
    await mongoose.disconnect();

    console.log(`\n${"─".repeat(60)}`);
    console.log(`  ${pass} passed, ${fail} failed`);
    if (failures.length) {
      console.log("\n  Failures:");
      failures.forEach((f) => console.log("   ✗ " + f));
    }
    console.log(`${"─".repeat(60)}\n`);
    process.exit(fail ? 1 : 0);
  });
