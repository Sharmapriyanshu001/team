/**
 * Additive demo data — team leaders, employees, clients, projects, tasks,
 * issues, attendance and work logs, enough to make every screen show
 * something real.
 *
 * Run with:  node seedDemo.js
 * Undo with: node seedDemo.js --remove
 *
 * Deliberately different from seedData.js, which clears the database first.
 * This one deletes nothing: an account whose email already exists is left
 * exactly as it is, and everything created is tagged so it can be taken back
 * out again without touching anything you made yourself.
 *
 * Every account signs in with its own mobile number as the password, which is
 * the convention the admin panel already uses.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";
import yazl from "yazl";

import User from "./models/User.js";
import Client from "./models/Client.js";
import Project from "./models/Project.js";
import Task from "./models/Task.js";
import Issue from "./models/Issue.js";
import WorkLog from "./models/WorkLog.js";
import Attendance from "./models/Attendance.js";
import Role from "./models/Role.js";
import FileDoc from "./models/FileDoc.js";
import CodeSubmission from "./models/CodeSubmission.js";
import CodePackage from "./models/CodePackage.js";
import CodeProject from "./models/CodeProject.js";
import ProjectVersion from "./models/ProjectVersion.js";
import Message from "./models/Message.js";
import Notification from "./models/Notification.js";
import Meeting from "./models/Meeting.js";
import Feedback from "./models/Feedback.js";
import { hashPassword } from "./utils/password.js";
import { UPLOAD_DIR, removeStoredFile } from "./utils/uploads.js";
import { extractZip } from "./utils/archive.js";
import { detectStack, measure, removeWorkspace, workspaceDir } from "./utils/workspaceFs.js";

dotenv.config();

/** Stamped on everything this script creates, so --remove is precise. */
const TAG = "[demo]";

const daysFromNow = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
};

const pick = (list, i) => list[i % list.length];

/* ------------------------------------------------------------------ people */

const LEADERS = [
  {
    name: "Vikas Sharma",
    email: "vikas.sharma@jhacompany.com",
    phone: "9829145507",
    designation: "Senior Project Lead",
    department: "Execution",
  },
  {
    name: "Meera Joshi",
    email: "meera.joshi@jhacompany.com",
    phone: "9812340091",
    designation: "Design Lead",
    department: "Design",
  },
  {
    name: "Imran Qureshi",
    email: "imran.qureshi@jhacompany.com",
    phone: "9845567712",
    designation: "Engineering Lead",
    department: "Engineering",
  },
];

const EMPLOYEES = [
  { name: "Sahil Kumar", email: "sahil.kumar@jhacompany.com", phone: "9887712043", designation: "Civil Engineer", department: "Execution", leader: 0 },
  { name: "Divya Patel", email: "divya.patel@jhacompany.com", phone: "9765430187", designation: "Architect", department: "Design", leader: 1 },
  { name: "Rohit Verma", email: "rohit.verma@jhacompany.com", phone: "9822334455", designation: "Site Supervisor", department: "Execution", leader: 0 },
  { name: "Anjali Nair", email: "anjali.nair@jhacompany.com", phone: "9701122334", designation: "Interior Designer", department: "Design", leader: 1 },
  { name: "Karan Mehta", email: "karan.mehta@jhacompany.com", phone: "9890011223", designation: "Frontend Developer", department: "Engineering", leader: 2 },
  { name: "Pooja Rane", email: "pooja.rane@jhacompany.com", phone: "9833445566", designation: "Backend Developer", department: "Engineering", leader: 2 },
  { name: "Aditya Singh", email: "aditya.singh@jhacompany.com", phone: "9911223344", designation: "QA Engineer", department: "Engineering", leader: 2 },
  { name: "Sneha Kulkarni", email: "sneha.kulkarni@jhacompany.com", phone: "9822556677", designation: "Draughtsman", department: "Design", leader: 1 },
];

const CLIENTS = [
  {
    name: "Rajesh Sharma",
    company: "Sharma Infrastructure Pvt Ltd",
    email: "rajesh.sharma@sharmainfra.in",
    phone: "9829011245",
    address: "C-42, Malviya Nagar, Jaipur, Rajasthan 302017",
    gstNumber: "08AABCS1429M1Z6",
    notes: `${TAG} Prefers a written progress summary every Friday.`,
  },
  {
    name: "Priya Mehta",
    company: "Mehta Developers",
    email: "priya.mehta@mehtadevelopers.in",
    phone: "9822067318",
    address: "Office 7, Baner Road, Pune, Maharashtra 411045",
    gstNumber: "27AACCM8823K1ZP",
    notes: `${TAG} Wants the design lead on every review call.`,
  },
];

/* ---------------------------------------------------------------- projects */

const PROJECTS = [
  { name: "Skyline Residency Tower B", code: "SKY-B", status: "in_progress", priority: "high", progress: 62, budget: 48000000, start: -120, end: 150, leader: 0, client: 0 },
  { name: "Mehta Commercial Complex", code: "MCC-01", status: "in_progress", priority: "medium", progress: 38, budget: 31500000, start: -70, end: 200, leader: 1, client: 1 },
  { name: "Sharma Farmhouse Interiors", code: "SFI-09", status: "planning", priority: "low", progress: 8, budget: 6200000, start: -14, end: 120, leader: 1, client: 0 },
  { name: "Company Portal Revamp", code: "WEB-02", status: "in_progress", priority: "high", progress: 55, budget: 1800000, start: -45, end: 60, leader: 2, client: null },
  { name: "Riverside Villas Phase 1", code: "RIV-P1", status: "completed", priority: "medium", progress: 100, budget: 27000000, start: -300, end: -20, leader: 0, client: 1 },
];

/* ------------------------------------------------------------------- tasks */

// Spread over statuses, priorities and dates so every filter has something.
const TASKS = [
  { title: "Review structural drawings for floors 9-12", status: "in_progress", priority: "high", due: 2, project: 0, emp: 0 },
  { title: "Site inspection report — week 14", status: "pending", priority: "medium", due: 1, project: 0, emp: 2 },
  { title: "Update BOQ after client revisions", status: "review", priority: "high", due: -1, project: 0, emp: 0 },
  { title: "Coordinate lift vendor site visit", status: "pending", priority: "low", due: 6, project: 0, emp: 2 },
  { title: "Fire safety clearance follow-up", status: "completed", priority: "high", due: -8, project: 0, emp: 2, rating: 4 },

  { title: "Facade material comparison sheet", status: "in_progress", priority: "medium", due: 3, project: 1, emp: 1 },
  { title: "Parking layout revision C", status: "pending", priority: "high", due: 0, project: 1, emp: 7 },
  { title: "Client presentation deck — phase 2", status: "review", priority: "medium", due: -2, project: 1, emp: 1 },
  { title: "Landscape lighting plan", status: "pending", priority: "low", due: 11, project: 1, emp: 3 },

  { title: "Furniture layout for master bedroom", status: "in_progress", priority: "medium", due: 4, project: 2, emp: 3 },
  { title: "Source Italian marble samples", status: "pending", priority: "low", due: 9, project: 2, emp: 7 },
  { title: "Kitchen elevation drawings", status: "completed", priority: "medium", due: -5, project: 2, emp: 3, rating: 5 },

  { title: "Rebuild the projects dashboard in React", status: "in_progress", priority: "high", due: 5, project: 3, emp: 4 },
  { title: "Attendance report API endpoint", status: "review", priority: "high", due: -1, project: 3, emp: 5 },
  { title: "Fix pagination on the tasks table", status: "pending", priority: "medium", due: 2, project: 3, emp: 4 },
  { title: "Write regression tests for login", status: "pending", priority: "high", due: 3, project: 3, emp: 6 },
  { title: "Mobile layout pass on the client portal", status: "pending", priority: "low", due: 8, project: 3, emp: 4 },
  { title: "Set up staging deployment", status: "completed", priority: "medium", due: -12, project: 3, emp: 5, rating: 4 },
  { title: "Cross-browser check on Safari", status: "in_progress", priority: "low", due: 7, project: 3, emp: 6 },

  { title: "Handover snag list closure", status: "completed", priority: "high", due: -25, project: 4, emp: 2, rating: 5 },
  { title: "Final completion certificate filing", status: "completed", priority: "medium", due: -18, project: 4, emp: 0, rating: 4 },
];

/* ------------------------------------------------------------------ issues */

const ISSUES = [
  { title: "Concrete pour delayed by supplier", severity: "high", status: "open", project: 0, emp: 2 },
  { title: "Drawing mismatch between architect and MEP", severity: "critical", status: "in_progress", project: 0, emp: 0 },
  { title: "Client changed facade colour after approval", severity: "medium", status: "open", project: 1, emp: 1 },
  { title: "Login session expires too quickly on mobile", severity: "medium", status: "in_progress", project: 3, emp: 4 },
  { title: "Attendance export misses half-day rows", severity: "low", status: "resolved", project: 3, emp: 5 },
  { title: "Marble delivery damaged in transit", severity: "high", status: "open", project: 2, emp: 3 },
];

/* ------------------------------------------------------------------- roles */

const ROLES = [
  {
    name: "Project Manager",
    key: "demo_project_manager",
    description: `${TAG} Runs projects and tasks, cannot touch staff or settings`,
    permissions: {
      dashboard: ["view"],
      clients: ["view"],
      projects: ["view", "create", "edit"],
      tasks: ["view", "create", "edit", "delete"],
      issues: ["view", "create", "edit"],
      files: ["view", "create"],
      code_projects: ["view"],
      reports: ["view"],
    },
  },
  {
    name: "Read Only",
    key: "demo_read_only",
    description: `${TAG} Can look at everything, change nothing`,
    permissions: {
      dashboard: ["view"],
      clients: ["view"],
      team_leaders: ["view"],
      employees: ["view"],
      projects: ["view"],
      tasks: ["view"],
      issues: ["view"],
      files: ["view"],
      code_projects: ["view"],
      code: ["view"],
      reports: ["view"],
      activity_logs: ["view"],
    },
  },
];

/* ------------------------------------------------------------ demo archives */

/**
 * A small static site, written to disk as a real ZIP and extracted through the
 * same path an upload takes. That makes the workspace, the editor, the version
 * history and the live preview all work on it — a code project you can only
 * look at would not tell you whether any of that is wired up.
 */
const DEMO_SITE = [
  {
    name: "index.html",
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>JHA Company</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <h1>Hello</h1>
      <p>Change this heading, press Ctrl+S, and watch the preview on the right.</p>
      <button id="count">Clicked 0 times</button>
    </main>
    <script src="app.js"></script>
  </body>
</html>
`,
  },
  {
    name: "style.css",
    content: `:root { color-scheme: light; }

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font: 16px/1.6 system-ui, sans-serif;
  background: #f8fafc;
  color: #0f172a;
}

main { text-align: center; padding: 2rem; }

h1 { font-size: 2.5rem; margin: 0 0 .5rem; color: #2563eb; }

button {
  margin-top: 1.5rem;
  padding: .6rem 1.2rem;
  font: inherit;
  border: 0;
  border-radius: .5rem;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
}
`,
  },
  {
    name: "app.js",
    content: `const button = document.getElementById("count");

let clicks = 0;
button.addEventListener("click", () => {
  clicks += 1;
  button.textContent = \`Clicked \${clicks} time\${clicks === 1 ? "" : "s"}\`;
});
`,
  },
  {
    name: "README.md",
    content: `# JHA Company site

A tiny static page, here so the workspace has something real to open.

- \`index.html\` — the page
- \`style.css\` — the styling
- \`app.js\` — the click counter

Edit any of these in the browser and save. The preview panel reloads itself.
`,
  },
  {
    name: "assets/logo.svg",
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="12" fill="#2563eb" />
  <text x="32" y="41" font-family="sans-serif" font-size="24" fill="#fff" text-anchor="middle">JHA</text>
</svg>
`,
  },
];

const DEMO_SNIPPET = [
  { name: "attendance-export.js", content: "// see the code review entry\n" },
];

/** Write an in-memory file list into uploads/ as a real ZIP. */
const writeZip = async (entries) => {
  const storedName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.zip`;
  const target = path.join(UPLOAD_DIR, storedName);

  const zip = new yazl.ZipFile();
  entries.forEach((entry) => zip.addBuffer(Buffer.from(entry.content, "utf8"), entry.name));
  zip.end();

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(target);
    zip.outputStream.on("error", reject);
    out.on("error", reject);
    out.on("close", resolve);
    zip.outputStream.pipe(out);
  });

  return { storedName, size: fs.statSync(target).size, originalName: "jha-website.zip" };
};

/* ------------------------------------------------------------------- helpers */

const summary = { created: {}, skipped: {} };
const note = (bucket, kind, n = 1) => {
  bucket[kind] = (bucket[kind] || 0) + n;
};

/* ------------------------------------------------------------------- remove */

const remove = async () => {
  console.log("Removing demo data (nothing else is touched)\n");

  const emails = [...LEADERS, ...EMPLOYEES].map((p) => p.email);
  const clientEmails = CLIENTS.map((c) => c.email);
  const projectCodes = PROJECTS.map((p) => p.code);

  const staff = await User.find({ email: { $in: emails } }).distinct("_id");
  const projects = await Project.find({ code: { $in: projectCodes } }).distinct("_id");

  const results = await Promise.all([
    Task.deleteMany({ $or: [{ project: { $in: projects } }, { assignedTo: { $in: staff } }] }),
    Issue.deleteMany({ project: { $in: projects } }),
    WorkLog.deleteMany({ employee: { $in: staff } }),
    Attendance.deleteMany({ employee: { $in: staff } }),
    Project.deleteMany({ code: { $in: projectCodes } }),
    User.deleteMany({ email: { $in: emails } }),
    Client.deleteMany({ email: { $in: clientEmails } }),
  ]);

  const labels = ["tasks", "issues", "work logs", "attendance", "projects", "staff", "clients"];
  results.forEach((r, i) => console.log(`  ${String(r.deletedCount).padStart(4)} ${labels[i]}`));

  console.log("\nDone. Your own accounts and data were not touched.");
};

/* --------------------------------------------------------------------- seed */

const seed = async () => {
  const admin = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).select("_id name");
  if (!admin) {
    console.error("No admin account found — run `node seedAdmin.js` first.");
    process.exitCode = 1;
    return;
  }

  /* ------------------------------------------------------------- clients */

  const clients = [];
  for (const entry of CLIENTS) {
    let doc = await Client.findOne({ email: entry.email });
    if (doc) {
      note(summary.skipped, "clients");
    } else {
      doc = await Client.create({
        ...entry,
        password: hashPassword(entry.phone),
        portalAccess: true,
        status: "active",
      });
      note(summary.created, "clients");
    }
    clients.push(doc);
  }

  /* ------------------------------------------------------- team leaders */

  const leaders = [];
  for (const entry of LEADERS) {
    let doc = await User.findOne({ email: entry.email });
    if (doc) {
      note(summary.skipped, "team leaders");
    } else {
      doc = await User.create({
        ...entry,
        password: hashPassword(entry.phone),
        role: "team_leader",
        status: "active",
        joiningDate: daysFromNow(-600 - leaders.length * 90),
      });
      note(summary.created, "team leaders");
    }
    leaders.push(doc);
  }

  /* ---------------------------------------------------------- employees */

  const employees = [];
  for (const [index, entry] of EMPLOYEES.entries()) {
    const { leader, ...rest } = entry;
    let doc = await User.findOne({ email: entry.email });
    if (doc) {
      note(summary.skipped, "employees");
    } else {
      doc = await User.create({
        ...rest,
        password: hashPassword(entry.phone),
        role: "employee",
        status: "active",
        reportsTo: leaders[leader]?._id,
        joiningDate: daysFromNow(-400 + index * 30),
      });
      note(summary.created, "employees");
    }
    employees.push(doc);
  }

  /* ----------------------------------------------------------- projects */

  const projects = [];
  for (const entry of PROJECTS) {
    let doc = await Project.findOne({ code: entry.code });
    if (doc) {
      note(summary.skipped, "projects");
    } else {
      // Everyone reporting to this project's leader works on it
      const members = employees
        .filter((_, i) => EMPLOYEES[i].leader === entry.leader)
        .map((e) => e._id);

      doc = await Project.create({
        name: entry.name,
        code: entry.code,
        description: `${TAG} ${entry.name}`,
        client: entry.client === null ? undefined : clients[entry.client]?._id,
        teamLeader: leaders[entry.leader]?._id,
        members,
        status: entry.status,
        priority: entry.priority,
        progress: entry.progress,
        budget: entry.budget,
        startDate: daysFromNow(entry.start),
        endDate: daysFromNow(entry.end),
      });
      note(summary.created, "projects");
    }
    projects.push(doc);
  }

  /* -------------------------------------------------------------- tasks */

  const tasks = [];
  for (const entry of TASKS) {
    const project = projects[entry.project];
    const assignee = employees[entry.emp];
    if (!project || !assignee) continue;

    const existing = await Task.findOne({ title: entry.title, project: project._id });
    if (existing) {
      note(summary.skipped, "tasks");
      tasks.push(existing);
      continue;
    }

    const doc = await Task.create({
      title: entry.title,
      description: `${TAG} ${entry.title}`,
      project: project._id,
      assignedTo: assignee._id,
      assignedBy: leaders[PROJECTS[entry.project].leader]?._id || admin._id,
      status: entry.status,
      priority: entry.priority,
      dueDate: daysFromNow(entry.due),
      completedAt: entry.status === "completed" ? daysFromNow(entry.due) : undefined,
      reviewRating: entry.rating || 0,
      // Anything not yet started is new to the assignee, which is what puts
      // the red dot on their sidebar — worth seeing on a demo login.
      seenByAssignee: entry.status !== "pending",
    });
    tasks.push(doc);
    note(summary.created, "tasks");
  }

  /* ------------------------------------------------------------- issues */

  for (const entry of ISSUES) {
    const project = projects[entry.project];
    const person = employees[entry.emp];
    if (!project || !person) continue;

    const existing = await Issue.findOne({ title: entry.title, project: project._id });
    if (existing) {
      note(summary.skipped, "issues");
      continue;
    }

    await Issue.create({
      title: entry.title,
      description: `${TAG} ${entry.title}`,
      project: project._id,
      raisedBy: person._id,
      assignedTo: leaders[PROJECTS[entry.project].leader]?._id,
      severity: entry.severity,
      status: entry.status,
      resolvedAt: entry.status === "resolved" ? daysFromNow(-3) : undefined,
    });
    note(summary.created, "issues");
  }

  /* ------------------------------------------------- attendance and logs */

  const STATUSES = ["present", "present", "present", "present", "half_day", "leave", "absent"];
  const SUMMARIES = [
    "Worked through the drawing set and marked the changes.",
    "Site visit in the morning, documentation after lunch.",
    "Pairing on the dashboard rebuild most of the day.",
    "Cleared review comments and pushed the fixes.",
    "Vendor coordination and follow-up calls.",
  ];

  for (const [index, employee] of employees.entries()) {
    for (let back = 1; back <= 21; back += 1) {
      const date = daysFromNow(-back);
      // Weekends stay empty, which is what makes the reports look real
      if ([0, 6].includes(date.getDay())) continue;

      const status = pick(STATUSES, index + back);

      const already = await Attendance.findOne({ employee: employee._id, date });
      if (!already) {
        await Attendance.create({
          employee: employee._id,
          date,
          status,
          checkIn: status === "absent" || status === "leave" ? "" : "09:4" + ((index + back) % 10),
          checkOut: status === "absent" || status === "leave" ? "" : status === "half_day" ? "13:30" : "18:2" + (back % 10),
        });
        note(summary.created, "attendance days");
      }

      if (status === "absent" || status === "leave") continue;

      const hasLog = await WorkLog.findOne({ employee: employee._id, date });
      if (!hasLog) {
        await WorkLog.create({
          employee: employee._id,
          date,
          hours: status === "half_day" ? 4 : 7 + ((index + back) % 3),
          summary: `${TAG} ${pick(SUMMARIES, index + back)}`,
          blockers: back % 9 === 0 ? "Waiting on the vendor to confirm delivery dates." : "",
          tasks: tasks
            .filter((t) => String(t.assignedTo) === String(employee._id))
            .slice(0, 2)
            .map((t) => t._id),
        });
        note(summary.created, "work logs");
      }
    }
  }

  /* ------------------------------------------------------------- report */

  console.log("\nCreated");
  Object.entries(summary.created).forEach(([k, v]) =>
    console.log(`  ${String(v).padStart(4)} ${k}`)
  );
  if (!Object.keys(summary.created).length) console.log("     0 — everything already existed");

  if (Object.keys(summary.skipped).length) {
    console.log("\nAlready there, left alone");
    Object.entries(summary.skipped).forEach(([k, v]) =>
      console.log(`  ${String(v).padStart(4)} ${k}`)
    );
  }

  console.log("\nLogins — the password is the mobile number");
  console.log("  " + "role".padEnd(13) + "email".padEnd(38) + "password");
  const row = (role, email, password) =>
    console.log("  " + role.padEnd(13) + email.padEnd(38) + password);

  LEADERS.forEach((l) => row("Team leader", l.email, l.phone));
  EMPLOYEES.forEach((e) => row("Employee", e.email, e.phone));
  CLIENTS.forEach((c) => row("Client", c.email, c.phone));

  console.log("\nYour existing accounts were not touched.");
  console.log("To take all of this back out again:  node seedDemo.js --remove");
};

/* --------------------------------------------------------------------- run */

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected\n");

  if (process.argv.includes("--remove")) await remove();
  else await seed();

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error("seedDemo error:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
