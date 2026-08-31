// Replaces the demo dataset with a small, real one: 2 clients, 2 team leaders
// and 2 employees, plus the projects and work that hang off them.
//
// Everything an admin owns (people, projects, tasks, issues, files, roles,
// settings, attendance) is created by calling the admin API — exactly what a
// person clicking through the admin panel would do. The few things that belong
// to other roles (an employee's work log, a client's meeting request and
// feedback, each side of a chat) are created by signing in as that person,
// because an admin cannot post those on their behalf.
//
// Run with:  npm run seed          (the API server must already be running)
// Override the admin login with ADMIN_EMAIL / ADMIN_PASSWORD.

import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "./models/User.js";
import Client from "./models/Client.js";
import Project from "./models/Project.js";
import Task from "./models/Task.js";
import Issue from "./models/Issue.js";
import FileDoc from "./models/FileDoc.js";
import Attendance from "./models/Attendance.js";
import Message from "./models/Message.js";
import ActivityLog from "./models/ActivityLog.js";
import Notification from "./models/Notification.js";
import WorkLog from "./models/WorkLog.js";
import Meeting from "./models/Meeting.js";
import Feedback from "./models/Feedback.js";
import Role from "./models/Role.js";

dotenv.config();

const API = process.env.API_URL || `http://localhost:${process.env.PORT || 5000}/api`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "abhay@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "abhay123";

// Every account signs in with its own mobile number as the password — that is
// what the admin form shows and what the API defaults to.
const passwordOf = (person) => person.phone;

/* ------------------------------------------------------------- http helper */

const call = async (token, method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${data.message || ""}`);
  }
  return data;
};

const login = async (path, email, password) => {
  const data = await call(null, "POST", path, { email, password });
  return data.token;
};

/* ------------------------------------------------------------------ dates */

const dayAt = (offsetDays, hours = 0, minutes = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

// Build YYYY-MM-DD from the local parts. Going through toISOString() would
// shift the date back a day for any timezone ahead of UTC, because local
// midnight is the previous day in UTC.
const isoDate = (offsetDays) => {
  const d = dayAt(offsetDays);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/* ------------------------------------------------------------------- data */

const CLIENTS = [
  {
    name: "Rajesh Sharma",
    company: "Sharma Infrastructure Pvt Ltd",
    email: "rajesh.sharma@sharmainfra.in",
    phone: "9829011245",
    address: "C-42, Malviya Nagar, Jaipur, Rajasthan 302017",
    gstNumber: "08AABCS1429M1Z6",
    status: "active",
    notes: "Prefers a written progress summary every Friday.",
    portalAccess: true,
  },
  {
    name: "Priya Mehta",
    company: "Mehta Developers",
    email: "priya.mehta@mehtadevelopers.in",
    phone: "9822067318",
    address: "Office 7, Baner Road, Pune, Maharashtra 411045",
    gstNumber: "27AACCM8823K1ZP",
    status: "active",
    notes: "Wants the design lead on every review call.",
    portalAccess: true,
  },
];

const LEADERS = [
  {
    name: "Arjun Kapoor",
    email: "arjun.kapoor@jhapcompany.com",
    phone: "9829145507",
    designation: "Senior Project Lead",
    department: "Execution",
    joiningDate: isoDate(-880),
    status: "active",
  },
  {
    name: "Meera Joshi",
    email: "meera.joshi@jhapcompany.com",
    phone: "9812340091",
    designation: "Design Lead",
    department: "Design",
    joiningDate: isoDate(-640),
    status: "active",
  },
];

const EMPLOYEES = [
  {
    name: "Sahil Kumar",
    email: "sahil.kumar@jhapcompany.com",
    phone: "9887712043",
    designation: "Civil Engineer",
    department: "Execution",
    joiningDate: isoDate(-410),
    status: "active",
    leader: 0,
  },
  {
    name: "Divya Patel",
    email: "divya.patel@jhapcompany.com",
    phone: "9765430187",
    designation: "Architect",
    department: "Design",
    joiningDate: isoDate(-300),
    status: "active",
    leader: 1,
  },
];

const ROLES = [
  {
    name: "Super Admin",
    key: "super_admin",
    description: "Full access to every module.",
    isSystem: true,
    permissions: {
      dashboard: ["view"],
      clients: ["view", "create", "edit", "delete"],
      team_leaders: ["view", "create", "edit", "delete"],
      employees: ["view", "create", "edit", "delete"],
      projects: ["view", "create", "edit", "delete"],
      tasks: ["view", "create", "edit", "delete"],
      chat: ["view", "create"],
      issues: ["view", "create", "edit", "delete"],
      files: ["view", "create", "edit", "delete"],
      reports: ["view"],
      activity_logs: ["view"],
      roles: ["view", "create", "edit", "delete"],
      settings: ["view", "edit"],
    },
  },
  {
    name: "Team Leader",
    key: "team_leader",
    description: "Runs projects, assigns work and signs it off.",
    permissions: {
      dashboard: ["view"],
      clients: ["view"],
      employees: ["view", "edit"],
      projects: ["view", "edit"],
      tasks: ["view", "create", "edit", "delete"],
      chat: ["view", "create"],
      issues: ["view", "create", "edit"],
      files: ["view", "create"],
      reports: ["view"],
    },
  },
  {
    name: "Employee",
    key: "employee",
    description: "Works on assigned tasks and logs daily work.",
    permissions: {
      dashboard: ["view"],
      projects: ["view"],
      tasks: ["view", "edit"],
      chat: ["view", "create"],
      issues: ["view", "create"],
      files: ["view"],
    },
  },
];

const run = async () => {
  console.log(`→ API: ${API}`);

  // Fail early with a useful message if the server is not up
  let adminToken;
  try {
    adminToken = await login("/admin/login", ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (err) {
    console.error(`\n❌ Could not sign in as admin (${ADMIN_EMAIL}).`);
    console.error(`   ${err.message}`);
    console.error("   Start the API first:  npm run dev\n");
    process.exitCode = 1;
    return;
  }
  console.log(`✅ Signed in as admin (${ADMIN_EMAIL})`);

  await mongoose.connect(process.env.MONGO_URI);

  /* ------------------------------------------------------------- clean out */

  console.log("🧹 Clearing the demo dataset...");
  await Promise.all([
    Client.deleteMany({}),
    Project.deleteMany({}),
    Task.deleteMany({}),
    Issue.deleteMany({}),
    FileDoc.deleteMany({}),
    Attendance.deleteMany({}),
    Message.deleteMany({}),
    ActivityLog.deleteMany({}),
    Notification.deleteMany({}),
    WorkLog.deleteMany({}),
    Meeting.deleteMany({}),
    Feedback.deleteMany({}),
    Role.deleteMany({}),
    // Only the admin account survives
    User.deleteMany({ role: { $ne: "admin" } }),
  ]);

  const admin = (adminToken && (await call(adminToken, "GET", "/admin/me"))).admin;

  const asAdmin = (method, path, body) => call(adminToken, method, path, body);

  /* -------------------------------------------------------------- settings */

  await asAdmin("PUT", "/admin/settings", {
    companyName: "JHA Company",
    companyEmail: "info@jhapcompany.com",
    companyPhone: "+91 141 400 8820",
    address: "3rd Floor, Ashok Marg, C-Scheme, Jaipur, Rajasthan 302001",
    website: "https://www.jhapcompany.com",
    currency: "INR",
    timezone: "Asia/Kolkata",
    workingHours: "09:30 - 18:30",
    emailNotifications: true,
    taskReminders: true,
    leaderClientChat: true,
    employeeClientChat: false,
  });
  console.log("   settings saved");

  /* ----------------------------------------------------------------- roles */

  for (const role of ROLES) await asAdmin("POST", "/admin/roles", role);
  console.log(`   ${ROLES.length} roles`);

  /* ---------------------------------------------------------------- people */

  const clients = [];
  for (const client of CLIENTS) {
    const { item } = await asAdmin("POST", "/admin/clients", client);
    clients.push(item);
  }
  console.log(`   ${clients.length} clients`);

  const leaders = [];
  for (const leader of LEADERS) {
    const { item } = await asAdmin("POST", "/admin/team-leaders", leader);
    leaders.push(item);
  }
  console.log(`   ${leaders.length} team leaders`);

  const employees = [];
  for (const { leader, ...employee } of EMPLOYEES) {
    const { item } = await asAdmin("POST", "/admin/employees", {
      ...employee,
      reportsTo: leaders[leader]._id,
    });
    employees.push(item);
  }
  console.log(`   ${employees.length} employees`);

  /* -------------------------------------------------------------- projects */

  const projectPayloads = [
    {
      name: "Green Valley Township",
      code: "PRJ-001",
      description:
        "Phase 1 of a 42-unit residential township: layout approvals, foundation and structural work up to plinth level.",
      client: clients[0]._id,
      teamLeader: leaders[0]._id,
      members: [employees[0]._id, employees[1]._id],
      status: "in_progress",
      priority: "high",
      progress: 45,
      budget: 24000000,
      startDate: isoDate(-70),
      endDate: isoDate(110),
    },
    {
      name: "Riverside Commercial Complex",
      code: "PRJ-002",
      description:
        "Ground-plus-four commercial block: concept design, municipal approvals and BOQ before execution starts.",
      client: clients[1]._id,
      teamLeader: leaders[1]._id,
      members: [employees[1]._id, employees[0]._id],
      status: "planning",
      priority: "medium",
      progress: 15,
      budget: 13500000,
      startDate: isoDate(-25),
      endDate: isoDate(160),
    },
  ];

  const projects = [];
  for (const payload of projectPayloads) {
    const { item } = await asAdmin("POST", "/admin/projects", payload);
    projects.push(item);
  }
  console.log(`   ${projects.length} projects`);

  /* ----------------------------------------------------------------- tasks */

  const taskPayloads = [
    // Green Valley Township — Sahil (execution) and Divya (design)
    {
      title: "Soil investigation report review",
      description: "Check the geotechnical report against the foundation assumptions.",
      project: 0,
      assignedTo: 0,
      status: "completed",
      priority: "high",
      dueDate: isoDate(-40),
      reviewRating: 5,
      reviewNote: "Thorough. Picked up the bearing capacity mismatch early.",
    },
    {
      title: "Foundation layout marking on site",
      description: "Set out the grid and get it verified by the site lead before excavation.",
      project: 0,
      assignedTo: 0,
      status: "completed",
      priority: "high",
      dueDate: isoDate(-22),
      reviewRating: 4,
      reviewNote: "Good work, keep the marking photos in the project folder.",
    },
    {
      title: "Plinth beam reinforcement check",
      description: "Verify bar diameters and spacing against the approved structural drawing.",
      project: 0,
      assignedTo: 0,
      status: "in_progress",
      priority: "high",
      dueDate: isoDate(0),
    },
    {
      title: "Weekly progress report for the client",
      description: "Photos, work done this week, and next week's plan for Sharma Infrastructure.",
      project: 0,
      assignedTo: 0,
      status: "pending",
      priority: "medium",
      dueDate: isoDate(2),
    },
    {
      title: "Revised unit layout drawings",
      description: "Incorporate the client's changes to the 2BHK balcony and re-issue.",
      project: 0,
      assignedTo: 1,
      status: "review",
      priority: "medium",
      dueDate: isoDate(-1),
    },

    // Riverside Commercial Complex — Divya leads the design work
    {
      title: "Concept design presentation",
      description: "Three facade options with indicative costs for the client review.",
      project: 1,
      assignedTo: 1,
      status: "completed",
      priority: "high",
      dueDate: isoDate(-12),
      reviewRating: 5,
      reviewNote: "Client picked option B on the spot. Well presented.",
    },
    {
      title: "Municipal approval drawing set",
      description: "Prepare the submission set as per JDA norms and share for checking.",
      project: 1,
      assignedTo: 1,
      status: "in_progress",
      priority: "high",
      dueDate: isoDate(0),
    },
    {
      title: "Preliminary BOQ for civil works",
      description: "Quantity take-off from the concept drawings for a budget estimate.",
      project: 1,
      assignedTo: 0,
      status: "pending",
      priority: "medium",
      dueDate: isoDate(6),
    },
  ];

  const tasks = [];
  for (const { project, assignedTo, ...task } of taskPayloads) {
    const { item } = await asAdmin("POST", "/admin/tasks", {
      ...task,
      project: projects[project]._id,
      assignedTo: employees[assignedTo]._id,
      assignedBy: admin.id,
    });
    tasks.push(item);
  }
  console.log(`   ${tasks.length} tasks`);

  /* ---------------------------------------------------------------- issues */

  const issuePayloads = [
    {
      title: "TMT steel delivery running two weeks late",
      description:
        "Vendor has pushed the 12mm and 16mm delivery. Plinth work will stall if it slips further.",
      project: 0,
      assignedTo: leaders[0]._id,
      raisedBy: employees[0]._id,
      severity: "high",
      status: "in_progress",
    },
    {
      title: "Setback dimension clash in the concept plan",
      description:
        "The rear setback is 3.0m against the 4.5m required by the local byelaw. Needs a layout revision.",
      project: 1,
      assignedTo: leaders[1]._id,
      raisedBy: employees[1]._id,
      severity: "critical",
      status: "open",
    },
  ];

  for (const { project, ...issue } of issuePayloads) {
    await asAdmin("POST", "/admin/issues", { ...issue, project: projects[project]._id });
  }
  console.log(`   ${issuePayloads.length} issues`);

  /* ----------------------------------------------------------------- files */

  const filePayloads = [
    {
      title: "Green Valley — signed work order.pdf",
      url: "https://files.jhapcompany.com/prj-001/work-order.pdf",
      category: "contract",
      fileType: "pdf",
      size: 486 * 1024,
      client: clients[0]._id,
      project: projects[0]._id,
    },
    {
      title: "Green Valley — structural drawings R2.dwg",
      url: "https://files.jhapcompany.com/prj-001/structural-r2.dwg",
      category: "design",
      fileType: "dwg",
      size: 3120 * 1024,
      client: clients[0]._id,
      project: projects[0]._id,
    },
    {
      title: "Riverside — concept design deck.pdf",
      url: "https://files.jhapcompany.com/prj-002/concept-deck.pdf",
      category: "design",
      fileType: "pdf",
      size: 7450 * 1024,
      client: clients[1]._id,
      project: projects[1]._id,
    },
    {
      title: "Riverside — advance invoice INV-2026-014.pdf",
      url: "https://files.jhapcompany.com/prj-002/inv-2026-014.pdf",
      category: "invoice",
      fileType: "pdf",
      size: 212 * 1024,
      client: clients[1]._id,
      project: projects[1]._id,
    },
  ];

  for (const file of filePayloads) await asAdmin("POST", "/admin/files", file);
  console.log(`   ${filePayloads.length} files`);

  /* ------------------------------------------------------------ attendance */

  const staff = [...leaders, ...employees];
  let attendanceDays = 0;

  for (let offset = -13; offset <= 0; offset += 1) {
    const date = dayAt(offset);
    if (date.getDay() === 0) continue; // office is closed on Sunday

    // One planned leave each, so the attendance charts are not a flat line
    const entries = staff.map((person, i) => {
      const onLeave =
        (offset === -6 && person._id === employees[0]._id) ||
        (offset === -3 && person._id === leaders[1]._id);

      return {
        employee: person._id,
        status: onLeave ? "leave" : "present",
        checkIn: onLeave ? "" : ["09:28", "09:35", "09:41", "09:33"][i % 4],
        checkOut: onLeave ? "" : ["18:34", "18:40", "18:29", "18:46"][i % 4],
      };
    });

    await asAdmin("POST", "/admin/attendance", { date: isoDate(offset), entries });
    attendanceDays += 1;
  }
  console.log(`   attendance for ${attendanceDays} working days`);

  /* ------------------------------------------------------- admin-side chat */

  const say = (path, roomId, text) =>
    asAdmin("POST", `/admin/chat/${path}/${roomId}`, { text });

  await say("client", clients[0]._id, "Good morning Rajesh — plinth work starts Monday.");
  await say("client", clients[1]._id, "Priya, the approval set goes in this week.");
  await say("team_leader", leaders[0]._id, "Arjun, please close the steel delivery issue by Friday.");
  await say("team_leader", leaders[1]._id, "Meera, keep the setback revision on top of the list.");
  await say("employee_admin", employees[0]._id, "Sahil, share the plinth photos with the report.");
  await say("employee_admin", employees[1]._id, "Divya, the client approved option B.");
  await say("project", projects[0]._id, "Site meeting at 11am on Thursday.");
  await say("project", projects[1]._id, "Approval set review call moved to Friday.");
  console.log("   admin chat messages");

  /* --------------------------------------------- work each role does itself */

  // Team leaders: reply to the admin and message their own team member
  for (const [i, leader] of leaders.entries()) {
    const token = await login("/leader/login", leader.email, passwordOf(LEADERS[i]));
    await call(token, "POST", `/leader/chat/admin/${leader._id}`, {
      text: i === 0 ? "Noted — vendor call is scheduled for tomorrow." : "On it, revision starts today.",
    });
    await call(token, "POST", `/leader/chat/employee/${employees[i]._id}`, {
      text:
        i === 0
          ? "Sahil, please double-check the bar spacing before the pour."
          : "Divya, send me the revised setback plan once it's ready.",
    });
    await call(token, "POST", `/leader/chat/client/${clients[i]._id}`, {
      text:
        i === 0
          ? "Rajesh, we're on track for the plinth milestone this month."
          : "Priya, sharing the revised layout for your review shortly.",
    });
  }
  console.log("   team leader chat messages");

  // Employees: reply to their leader and log the last few days of work
  const workLogs = [
    ["Checked reinforcement at grid A to D and marked the corrections for the bar bender.", 8, ""],
    ["Site supervision for the plinth beam shuttering, plus the vendor follow-up call.", 7.5, "TMT steel delivery still not confirmed."],
    ["Prepared the quantity take-off sheet and updated the weekly progress deck.", 8, ""],
  ];

  for (const [i, employee] of employees.entries()) {
    const token = await login("/employee/login", employee.email, passwordOf(EMPLOYEES[i]));

    await call(token, "POST", `/employee/chat/team_leader/${employee._id}`, {
      text:
        i === 0
          ? "Will do — I'll send the checked drawing by evening."
          : "Revised plan is almost done, sharing it today.",
    });
    await call(token, "POST", `/employee/chat/admin/${employee._id}`, {
      text: i === 0 ? "Photos uploaded to the project folder." : "Noted, thanks for confirming.",
    });

    for (const [offset, [summary, hours, blockers]] of workLogs.entries()) {
      const date = dayAt(-offset);
      if (date.getDay() === 0) continue;

      await call(token, "POST", "/employee/daily-work", {
        date: isoDate(-offset),
        hours,
        summary: i === 0 ? summary : summary.replace("reinforcement", "drawings"),
        blockers: i === 0 ? blockers : "",
      });
    }
  }
  console.log("   employee chat messages and work logs");

  // Clients: message the team, request a meeting and leave feedback
  for (const [i, client] of clients.entries()) {
    const token = await login("/client/login", client.email, passwordOf(CLIENTS[i]));

    await call(token, "POST", `/client/chat/admin/${client._id}`, {
      text:
        i === 0
          ? "Thanks — please share the photos once the pour is done."
          : "Great. Can we review the facade options on a call?",
    });
    await call(token, "POST", `/client/chat/team_leader/${client._id}`, {
      text: i === 0 ? "Appreciate the update, Arjun." : "Looking forward to the revised layout.",
    });

    await call(token, "POST", "/client/meetings", {
      title: i === 0 ? "Monthly progress review" : "Facade options walkthrough",
      agenda:
        i === 0
          ? "Site photos, plinth milestone and the steel delivery delay."
          : "Go through the three facade options and pick the final one.",
      project: projects[i]._id,
      scheduledAt: dayAt(i === 0 ? 4 : 6, 11, 30).toISOString(),
      durationMinutes: i === 0 ? 45 : 60,
      mode: i === 0 ? "site" : "online",
    });

    await call(token, "POST", "/client/feedback", {
      project: projects[i]._id,
      category: i === 0 ? "communication" : "quality",
      rating: i === 0 ? 5 : 4,
      message:
        i === 0
          ? "The weekly updates are clear and the site team picks up the phone. Very happy so far."
          : "Design quality is good. Would like the approval timeline to be a bit tighter.",
    });
  }
  console.log("   client chat, meeting requests and feedback");

  /* --------------------------------------------------------------- summary */

  const counts = await Promise.all([
    Client.countDocuments(),
    User.countDocuments({ role: "team_leader" }),
    User.countDocuments({ role: "employee" }),
    Project.countDocuments(),
    Task.countDocuments(),
    Issue.countDocuments(),
    FileDoc.countDocuments(),
    Attendance.countDocuments(),
    WorkLog.countDocuments(),
    Meeting.countDocuments(),
    Feedback.countDocuments(),
    Message.countDocuments(),
    Notification.countDocuments(),
  ]);

  const [
    clientCount, leaderCount, employeeCount, projectCount, taskCount, issueCount,
    fileCount, attendanceCount, workLogCount, meetingCount, feedbackCount,
    messageCount, notificationCount,
  ] = counts;

  console.log("\n✅ Saved to MongoDB");
  console.log(`   clients ${clientCount} · team leaders ${leaderCount} · employees ${employeeCount}`);
  console.log(`   projects ${projectCount} · tasks ${taskCount} · issues ${issueCount} · files ${fileCount}`);
  console.log(`   attendance ${attendanceCount} · work logs ${workLogCount}`);
  console.log(`   meetings ${meetingCount} · feedback ${feedbackCount}`);
  console.log(`   messages ${messageCount} · notifications ${notificationCount}`);

  console.log("\n🔑 Logins — login ID is the email, password is the mobile number");
  const row = (role, email, password) =>
    console.log(`   ${role.padEnd(12)} ${email.padEnd(34)} ${password}`);

  row("Admin", ADMIN_EMAIL, ADMIN_PASSWORD);
  LEADERS.forEach((l) => row("Team leader", l.email, passwordOf(l)));
  EMPLOYEES.forEach((e) => row("Employee", e.email, passwordOf(e)));
  CLIENTS.forEach((c) => row("Client", c.email, passwordOf(c)));

  console.log("\n   A custom password can be set from that person's edit form in the admin panel.\n");
};

run()
  .catch((err) => {
    console.error("\n❌ seedData error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
