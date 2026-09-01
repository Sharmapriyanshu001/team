import fs from "fs";
import express from "express";

import adminAuth from "../middleware/adminAuth.js";
import { loginBurstLimiter, loginLimiter } from "../middleware/security.js";
import { guard, guardAction, requireSuperAdmin } from "../middleware/permissions.js";
import {
  listAdministrators,
  updateAdministrator,
  roleIsInUse,
} from "../controllers/administratorController.js";
import { buildCrud, InvalidInput } from "../utils/crud.js";
import { hashPassword } from "../utils/password.js";
import { notifyUser } from "../utils/notify.js";

import User from "../models/User.js";
import Client from "../models/Client.js";
import Project from "../models/Project.js";
import Task from "../models/Task.js";
import Issue from "../models/Issue.js";
import FileDoc from "../models/FileDoc.js";
import ActivityLog from "../models/ActivityLog.js";
import Role, { PERMISSION_MODULES, PERMISSION_ACTIONS } from "../models/Role.js";

import { adminLogin, adminLogout, adminProfile } from "../controllers/adminController.js";
import {
  listNotifications,
  markNotificationRead,
  markAllRead,
} from "../controllers/adminNotificationController.js";
import { getDashboard } from "../controllers/dashboardController.js";
import { getInsight } from "../controllers/insightsController.js";
import {
  consoles,
  removeConsole,
  apps,
  removeApp,
  appDetail,
  listReleases,
  createRelease,
  updateRelease,
  removeRelease,
  alerts,
  playOverview,
} from "../controllers/playConsoleController.js";
import {
  projects as seoProjects,
  projectDetail as seoProjectDetail,
  listKeywords,
  keywordHistory,
  addKeywords,
  recordRank,
  updateKeyword,
  removeKeyword,
  audits,
  updateAuditIssue,
  backlinks,
  checkBacklinks,
  socialAccounts,
  recordFollowers,
  socialPosts,
  monthlyReport,
} from "../controllers/seoController.js";
import {
  leads,
  addLeadNote,
  convertLead,
  pipeline,
  services,
  quotations,
  createQuotation,
  updateQuotation,
  quotationToInvoice,
  invoices,
  createInvoice,
  updateInvoice,
  addPayment,
  removePayment,
  invoiceDetail,
  receivables,
} from "../controllers/crmController.js";
import {
  accounts as adAccounts,
  accountDetail,
  adsOverview,
  listCampaigns,
  campaignDetail,
  createCampaign,
  updateCampaign,
  removeCampaign,
  recordDay,
  importDays,
  addTopup,
  billPeriod,
  periodReport,
} from "../controllers/adsController.js";
import {
  properties,
  propertyDetail,
  propertyHistory,
  listEntries,
  addEntry,
  updateEntry,
  removeEntry,
  payPartner,
  listPayouts,
  portfolio,
} from "../controllers/portfolioController.js";
import {
  listCredentials,
  createCredential,
  updateCredential,
  removeCredential,
  revealCredential,
  credentialAccessLog,
} from "../controllers/vaultController.js";
import {
  teamLeaderPerformance,
  employeePerformance,
} from "../controllers/performanceController.js";
import { staffDetails, clientDetails } from "../controllers/recordDetailController.js";
import { projectDetails } from "../controllers/projectDetailController.js";
import {
  getAttendanceSheet,
  saveAttendance,
  getAttendanceSummary,
} from "../controllers/attendanceController.js";
import { getRooms, getMessages, sendMessage } from "../controllers/chatController.js";
import {
  listMeetings,
  updateMeeting,
  regenerateLink,
} from "../controllers/meetingController.js";
import { uploadZip, uploadStaffDocuments, removeStoredFile, storedPath } from "../utils/uploads.js";
import {
  applyStaffPaperwork,
  discardUploadsIfRefused,
  findPaperwork,
  paperworkFiles,
} from "../utils/staffDocuments.js";
import {
  uploadFile,
  assignFile,
  downloadFile,
} from "../controllers/fileAssignmentController.js";
import { assignWork } from "../controllers/assignWorkController.js";
import {
  sendPackage,
  listSent,
  listReceived,
  listPeople,
  downloadPackage,
  removePackage,
} from "../controllers/codePackageController.js";
import {
  createCodeProject,
  listCodeProjects,
  getCodeProject,
  getCodeProjectTree,
  downloadOriginalZip,
  updateCodeProject,
  removeCodeProject,
  restoreCodeProject,
  purgeCodeProject,
} from "../controllers/codeProjectController.js";
import {
  listRequests,
  approveRequest,
  rejectRequest,
} from "../controllers/projectRequestController.js";
import { createPreviewToken } from "../controllers/previewController.js";
import {
  getRunStatus,
  getRunLogs,
  startRun,
  stopRun,
  sendRunInput,
  createSession,
  removeSession,
} from "../controllers/runController.js";
import {
  readFile,
  saveFile,
  createFile,
  createFolder,
  renameEntry,
  deleteEntry,
  searchWorkspace,
} from "../controllers/workspaceFileController.js";
import {
  listVersions,
  createVersion,
  downloadVersion,
  restoreVersion,
  removeVersion,
} from "../controllers/projectVersionController.js";
import {
  adminListSubmissions,
  getSubmission,
  reviewSubmission,
  shareSubmission,
  revokeShare,
  downloadSubmission,
} from "../controllers/codeShareController.js";
import { getReports } from "../controllers/reportController.js";
import {
  getSettings,
  updateSettings,
  updateProfile,
  changePassword,
} from "../controllers/settingsController.js";

const router = express.Router();

/* ------------------------------------------------------------------ auth */

// Guessing a password is the one attack this endpoint cannot refuse on
// its own merits, so it is throttled rather than argued with.
router.post("/login", loginBurstLimiter, loginLimiter, adminLogin);
// Ending a session is something only a live session can ask for, so this
// sits behind the same door as everything else rather than beside the login.
router.post("/logout", adminAuth, adminLogout);

// Everything below this line needs a valid admin token
router.use(adminAuth);

router.get("/me", adminProfile);

/* --------------------------------------------------------- permissions */

/**
 * Module guards, mounted on the path rather than on each route, so a route
 * added under one of these later cannot quietly miss its check. The action
 * comes from the HTTP verb — see middleware/permissions.js.
 *
 * An admin with no permission role assigned passes all of these, which is
 * exactly how every admin behaved before this existed. Nothing changes for an
 * account until a super admin deliberately gives it a role.
 *
 * Deliberately ungated: /me and /lookups. The first is how the panel learns
 * what this account may do, and the second fills the dropdowns on every form —
 * gating it would break screens the admin *is* allowed to use.
 */
router.use("/dashboard", guard("dashboard"));
router.use("/insights", guard("dashboard"));
router.use("/clients", guard("clients"));
// Meetings are client meetings, so they answer to the same permission rather
// than introducing a module every existing role would be missing
router.use("/meetings", guard("clients"));
router.use("/team-leaders", guard("team_leaders"));
router.use("/employees", guard("employees"));
router.use("/attendance", guard("employees"));
router.use("/projects", guard("projects"));
router.use("/tasks", guard("tasks"));
router.use("/chat", guard("chat"));
router.use("/issues", guard("issues"));
router.use("/files", guard("files"));
router.use("/assign-work", guard("tasks"));
router.use("/code-projects", guard("code_projects"));
router.use("/workspace", guard("code_projects"));
router.use("/code-share", guard("code"));
router.use("/code", guard("code"));
router.use("/play", guard("play_console"));
router.use("/seo", guard("seo"));
router.use("/crm", guard("crm"));
router.use("/ads", guard("ads"));
router.use("/portfolio", guard("portfolio"));
router.use("/vault", guard("vault"));
router.use("/reports", guard("reports"));
router.use("/activity-logs", guard("activity_logs"));
router.use("/roles", guard("roles"));
router.use("/settings", guard("settings"));

router.get("/dashboard", getDashboard);
router.get("/insights/:metric", getInsight);

/* --------------------------------------------------------------- helpers */

// Staff (team leaders + employees) share the User model, so both reuse this.
const staffBeforeSave = (payload) => {
  const data = { ...payload };

  // The password is hashed by the caller once it has been resolved
  delete data.password;

  // Empty strings from <select> inputs must not be cast to ObjectId
  if (!data.reportsTo) delete data.reportsTo;

  return data;
};

/**
 * The login password is the person's mobile number unless the admin types a
 * different one. That keeps the credentials easy to hand over, and the form
 * shows exactly what they will be.
 */
const resolveLoginPassword = (payload, existing, label) => {
  const custom = (payload.password || "").trim();
  const phone = (payload.phone ?? existing?.phone ?? "").trim();

  if (custom) {
    if (custom.length < 6) {
      throw new InvalidInput("Password must be at least 6 characters");
    }
    return custom;
  }

  // No custom password: fall back to the mobile number
  if (!existing) {
    if (!phone) {
      throw new InvalidInput(`Enter a mobile number — it becomes the ${label}'s login password`);
    }
    if (phone.replace(/\D/g, "").length < 6) {
      throw new InvalidInput("Mobile number looks too short to use as a password");
    }
    return phone;
  }

  // On an update, leave the existing password alone unless the phone changed
  if (payload.phone !== undefined && payload.phone !== existing.phone && phone) {
    return phone;
  }
  return null;
};

const staffCrudOptions = (role) => {
  const label = role === "team_leader" ? "team leader" : "employee";

  return {
    entity: role === "team_leader" ? "Team Leader" : "Employee",
    searchFields: ["name", "email", "designation", "department", "phone"],
    filterFields: ["status", "department"],
    scope: { role },
    createDefaults: { role },
    // A list of staff is a table of names and departments. Nobody reading one
    // needs the whole company's Aadhaar numbers and bank accounts in their
    // browser, so those three sub-documents are left out of it and fetched
    // only when one person is actually opened.
    select: "-password -documents -bank -previousEmployment",
    selectOne: "-password",
    populate: [{ path: "reportsTo", select: "name email" }],
    sort: { createdAt: -1 },
    beforeSave: (payload, req, existing) => {
      const password = resolveLoginPassword(payload, existing, label);
      const { data: withPapers, orphaned } = applyStaffPaperwork(payload, req, existing);
      const data = staffBeforeSave(withPapers);

      if (password) {
        data.password = hashPassword(password);
      // A reset is usually done because the old password should stop working
      // — the person was locked out, or it leaked. Leaving their live tokens
      // alone would make the reset cosmetic for another seven days.
      data.tokenVersion = (existing?.tokenVersion || 0) + 1;
      }
      data.role = role;

      // Documents this save replaced. Removed only once the record itself has
      // been written, so a failed save never takes the old file with it.
      if (orphaned.length) {
        req.res?.on("finish", () => {
          if (req.res.statusCode < 400) orphaned.forEach(removeStoredFile);
        });
      }

      return data;
    },
  };
};

/**
 * Serving one of a member of staff's documents back.
 *
 * Nothing under uploads/ is reachable without going through a route, which is
 * what makes this the only way to see somebody's Aadhaar scan — and why it is
 * mounted behind the same permission guard as the rest of their record rather
 * than being a link the browser could follow on its own.
 */
const staffDocument = (role) => async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id, role }).select(
      "documents previousEmployment"
    );
    if (!user) return res.status(404).json({ message: "Not found" });

    const file = findPaperwork(user, req.params.field);
    const target = file && storedPath(file.storedName);
    if (!target) return res.status(404).json({ message: "That document is not on file" });

    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    // Shown in a tab rather than pushed to the downloads folder: the admin is
    // usually checking a card against a form, not collecting files.
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${(file.originalName || req.params.field).replace(/"/g, "")}"`
    );

    const stream = fs.createReadStream(target);
    stream.on("error", (err) => {
      console.error("staffDocument stream error:", err.message);
      if (!res.headersSent) res.status(500).json({ message: "Could not read that document" });
    });
    return stream.pipe(res);
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Not found" });
    console.error("staffDocument error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** Deleting the person takes their paperwork off the disk with them. */
const removeStaff = (role, crud) => async (req, res) => {
  const existing = await User.findOne({ _id: req.params.id, role }).select(
    "documents previousEmployment"
  );
  const files = existing ? paperworkFiles(existing) : [];

  res.on("finish", () => {
    if (res.statusCode < 400) files.forEach(removeStoredFile);
  });

  return crud.remove(req, res);
};

// Strip empty ObjectId-ish fields so Mongoose does not throw a CastError.
const cleanRefs = (fields) => (payload) => {
  const data = { ...payload };
  fields.forEach((field) => {
    if (data[field] === "" || data[field] === null) delete data[field];
  });
  return data;
};

/* --------------------------------------------------------------- clients */

const clients = buildCrud(Client, {
  entity: "Client",
  searchFields: ["name", "company", "email", "phone"],
  filterFields: ["status"],
  select: "-password",
  // The portal password is the client's mobile number unless one is typed in
  beforeSave: (payload, req, existing) => {
    const data = { ...payload };
    const password = resolveLoginPassword(payload, existing, "client");

    if (password) {
      data.password = hashPassword(password);
      // A reset is usually done because the old password should stop working
      // — the person was locked out, or it leaked. Leaving their live tokens
      // alone would make the reset cosmetic for another seven days.
      data.tokenVersion = (existing?.tokenVersion || 0) + 1;
    } else delete data.password;

    return data;
  },
});

router.get("/clients", clients.list);
router.post("/clients", clients.create);
router.get("/clients/:id/details", clientDetails);
router.get("/clients/:id", clients.getOne);
router.put("/clients/:id", clients.update);
router.delete("/clients/:id", clients.remove);

/* -------------------------------------------------------------- meetings */

// What clients have asked for, and the join link on each one
router.get("/meetings", listMeetings);
router.post("/meetings/:id/link", regenerateLink);
router.put("/meetings/:id", updateMeeting);

/* --------------------------------------------------------- team leaders */

const teamLeaders = buildCrud(User, staffCrudOptions("team_leader"));

router.get("/team-leaders/performance", teamLeaderPerformance);
router.get("/team-leaders", teamLeaders.list);

/**
 * The add form sends four steps at once, so these two take multipart: the
 * details and the bank fields as text, the Aadhaar and PAN scans as files.
 * A plain JSON body still works — multer leaves one alone — so nothing that
 * posted to these before has to change.
 */
router.post(
  "/team-leaders",
  uploadStaffDocuments,
  discardUploadsIfRefused,
  teamLeaders.create
);

router.get("/team-leaders/:id/details", staffDetails("team_leader"));
router.get("/team-leaders/:id/documents/:field", staffDocument("team_leader"));
router.get("/team-leaders/:id", teamLeaders.getOne);

router.put(
  "/team-leaders/:id",
  uploadStaffDocuments,
  discardUploadsIfRefused,
  teamLeaders.update
);

router.delete("/team-leaders/:id", removeStaff("team_leader", teamLeaders));

/* ------------------------------------------------------------- employees */

const employees = buildCrud(User, staffCrudOptions("employee"));

router.get("/employees/performance", employeePerformance);
router.get("/employees", employees.list);

// Same four-step form, same paperwork — see the team leader routes above
router.post("/employees", uploadStaffDocuments, discardUploadsIfRefused, employees.create);

router.get("/employees/:id/details", staffDetails("employee"));
router.get("/employees/:id/documents/:field", staffDocument("employee"));
router.get("/employees/:id", employees.getOne);

router.put("/employees/:id", uploadStaffDocuments, discardUploadsIfRefused, employees.update);

router.delete("/employees/:id", removeStaff("employee", employees));

/* ------------------------------------------------------------ attendance */

router.get("/attendance/summary", getAttendanceSummary);
router.get("/attendance", getAttendanceSheet);
router.post("/attendance", saveAttendance);

/* -------------------------------------------------------------- projects */

const projects = buildCrud(Project, {
  entity: "Project",
  searchFields: ["name", "code", "description"],
  filterFields: ["status", "priority", "client", "teamLeader"],
  populate: [
    { path: "client", select: "name company" },
    { path: "teamLeader", select: "name email designation" },
    { path: "members", select: "name email designation" },
  ],
  beforeSave: cleanRefs(["client", "teamLeader", "startDate", "endDate"]),
  // Tell a team leader when a project lands on their desk
  afterSave: (project, req, { isNew, previous }) => {
    const changedLeader = String(previous?.teamLeader || "") !== String(project.teamLeader || "");
    if (!project.teamLeader || (!isNew && !changedLeader)) return;

    notifyUser(project.teamLeader, {
      type: "project",
      title: isNew ? "New project assigned" : "You now lead this project",
      message: `"${project.name}" — ${project.status.replace(/_/g, " ")}`,
      link: "/team-leader/projects/active",
    });
  },
});

router.get("/projects", projects.list);
router.post("/projects", projects.create);
router.get("/projects/:id/details", projectDetails);
router.get("/projects/:id", projects.getOne);
router.put("/projects/:id", projects.update);
router.delete("/projects/:id", projects.remove);

/* ----------------------------------------------------------------- tasks */

const tasks = buildCrud(Task, {
  entity: "Task",
  searchFields: ["title", "description"],
  filterFields: ["status", "priority", "project", "assignedTo"],
  populate: [
    { path: "project", select: "name code" },
    { path: "assignedTo", select: "name email designation" },
  ],
  label: (doc) => doc?.title,
  beforeSave: (payload, req, existing) => {
    const data = cleanRefs(["project", "assignedTo", "assignedBy", "dueDate"])(payload);
    // Whoever is signed in is the one handing the work out
    if (!data.assignedBy) data.assignedBy = req.admin._id;

    // The dot on the assignee's sidebar is ours to set, never the caller's
    delete data.seenByAssignee;

    // Work landing on someone new is unseen work — an edit that leaves the
    // assignee alone must not light the dot up again.
    const movedToSomeoneNew =
      String(existing?.assignedTo || "") !== String(data.assignedTo || "");
    if (data.assignedTo && movedToSomeoneNew) data.seenByAssignee = false;

    return data;
  },
  // ?due=today | overdue — powers the "Daily Tasks" screen
  extraQuery: (req) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (req.query.due === "today") return { dueDate: { $gte: today, $lt: tomorrow } };
    if (req.query.due === "overdue")
      return { dueDate: { $lt: today }, status: { $ne: "completed" } };
    return {};
  },
  afterSave: async (task, req, { isNew, previous }) => {
    // Work handed to someone has to reach them, whether they are a team leader
    // or an employee — the panel they land on depends on their role.
    const changedAssignee =
      String(previous?.assignedTo || "") !== String(task.assignedTo || "");

    if (task.assignedTo && (isNew || changedAssignee)) {
      const [assignee, project] = await Promise.all([
        User.findById(task.assignedTo).select("role"),
        task.project ? Project.findById(task.project).select("name") : null,
      ]);

      if (assignee) {
        notifyUser(task.assignedTo, {
          type: "task",
          title: isNew ? "New task assigned to you" : "A task was reassigned to you",
          message: `"${task.title}"${project ? ` on ${project.name}` : ""}`,
          link:
            assignee.role === "team_leader"
              ? "/team-leader/tasks/pending"
              : "/employee/tasks/pending",
        });
      }
    }

    // A task moving into review needs the project's leader to sign it off
    if (task.status !== "review" || previous?.status === "review") return;

    const project = await Project.findById(task.project).select("name teamLeader");
    if (!project?.teamLeader) return;

    notifyUser(project.teamLeader, {
      type: "review",
      title: "Work waiting for review",
      message: `"${task.title}" on ${project.name}`,
      link: "/team-leader/daily-review",
    });
  },
});

router.get("/tasks", tasks.list);
router.post("/tasks", tasks.create);
router.get("/tasks/:id", tasks.getOne);
router.put("/tasks/:id", tasks.update);
router.delete("/tasks/:id", tasks.remove);

/* ---------------------------------------------------------------- issues */

const issues = buildCrud(Issue, {
  entity: "Issue",
  searchFields: ["title", "description"],
  filterFields: ["status", "severity", "project", "assignedTo"],
  populate: [
    { path: "project", select: "name code" },
    { path: "assignedTo", select: "name email" },
    { path: "raisedBy", select: "name email" },
  ],
  label: (doc) => doc?.title,
  beforeSave: cleanRefs(["project", "assignedTo", "raisedBy"]),
  afterSave: async (issue, req, { isNew }) => {
    if (!isNew || !issue.project) return;

    const project = await Project.findById(issue.project).select("name teamLeader");
    if (!project?.teamLeader) return;

    notifyUser(project.teamLeader, {
      type: "issue",
      title: `New ${issue.severity} issue`,
      message: `"${issue.title}" on ${project.name}`,
      link: "/team-leader/issues",
    });
  },
});

router.get("/issues", issues.list);
router.post("/issues", issues.create);
router.get("/issues/:id", issues.getOne);
router.put("/issues/:id", issues.update);
router.delete("/issues/:id", issues.remove);

/* ----------------------------------------------------------------- files */

const files = buildCrud(FileDoc, {
  entity: "File",
  searchFields: ["title", "fileType", "originalName"],
  filterFields: ["category", "client", "project", "status", "assignedTo"],
  populate: [
    { path: "client", select: "name company" },
    { path: "project", select: "name code" },
    { path: "uploadedBy", select: "name" },
    { path: "assignedTo", select: "name email role designation" },
    { path: "assignedBy", select: "name" },
  ],
  label: (doc) => doc?.title,
  // The upload and assign routes below own those fields — an edit of the
  // details must not be able to hand the file to someone else on the quiet.
  beforeSave: (payload, req) => {
    const data = cleanRefs(["client", "project"])({ ...payload, uploadedBy: req.admin._id });

    [
      "storedName",
      "originalName",
      "mimeType",
      "assignedTo",
      "assignedRole",
      "assignedBy",
      "assignedAt",
      "status",
      "downloadedAt",
      "completedAt",
    ].forEach((field) => delete data[field]);

    return data;
  },
});

// One brief to many people, with an optional ZIP riding along
router.post("/assign-work", uploadZip, assignWork);

router.post("/files/upload", uploadZip, uploadFile);
router.get("/files/:id/download", downloadFile);
router.put("/files/:id/assign", assignFile);

router.get("/files", files.list);
router.post("/files", files.create);
router.get("/files/:id", files.getOne);
router.put("/files/:id", files.update);

// Deleting the record has to take the archive on disk with it
router.delete("/files/:id", async (req, res) => {
  const existing = await FileDoc.findById(req.params.id).select("storedName");
  if (existing?.storedName) removeStoredFile(existing.storedName);
  return files.remove(req, res);
});

/* -------------------------------------------------------------- code projects */

// An uploaded archive becomes a workspace people open in the browser. The
// admin owns creation and assignment; the workspace itself is served to
// assigned staff from their own panels.
router.post("/code-projects", uploadZip, createCodeProject);
router.get("/code-projects", listCodeProjects);

/**
 * The request queue: what team leaders and employees have asked the admin to
 * change or remove. Approving is the only thing in the app that turns one of
 * those asks into a change — and each handler asks for the permission the act
 * needs rather than the one the verb implies, because approving a delete
 * request deletes.
 *
 * All three sit above "/code-projects/:id" or "requests" is read as an id.
 */
router.get("/code-projects/requests", listRequests);
router.post("/code-projects/requests/:requestId/approve", approveRequest);
router.post("/code-projects/requests/:requestId/reject", rejectRequest);

// Version history. Rolling back and deleting a version are admin-only and
// mounted only here — both are destructive for everyone else on the project.
router.get("/code-projects/:id/versions", listVersions);
router.post("/code-projects/:id/versions", createVersion);
router.get("/code-projects/:id/versions/:version/archive", downloadVersion);
router.post("/code-projects/:id/versions/:version/restore", restoreVersion);
router.delete("/code-projects/:id/versions/:version", removeVersion);

router.get("/code-projects/:id/tree", getCodeProjectTree);
router.get("/code-projects/:id/archive", downloadOriginalZip);
router.get("/code-projects/:id", getCodeProject);
router.put("/code-projects/:id", updateCodeProject);

// Delete moves the project to the bin; these two are what the bin is for.
// Destroying the files is deliberately its own route with its own verb — it
// cannot be reached by a stray click on the ordinary delete button.
router.post("/code-projects/:id/restore", restoreCodeProject);
router.delete("/code-projects/:id/permanent", purgeCodeProject);
router.delete("/code-projects/:id", removeCodeProject);

// The workspace itself. Same two routes on all three panels — the controller
// re-checks the project, the caller and the path on every single call.
router.get("/workspace/:id/file", readFile);
router.put("/workspace/:id/file", saveFile);
router.get("/workspace/:id/search", searchWorkspace);
router.get("/workspace/:id/preview-token", createPreviewToken);

// Installing and running the project. Same canRun permission as the preview:
// seeing a project run and starting it are one decision, not two.
router.get("/workspace/:id/run", getRunStatus);
router.get("/workspace/:id/run/logs", getRunLogs);
router.post("/workspace/:id/run", startRun);
router.post("/workspace/:id/run/input", sendRunInput);
router.post("/workspace/:id/run/session", createSession);
router.delete("/workspace/:id/run/session/:session", removeSession);
router.delete("/workspace/:id/run", stopRun);

// Creating, renaming and deleting are gated on canCreateDelete, which is a
// separate permission from editing: an assignee may be trusted to change a
// file without being trusted to remove one.
router.post("/workspace/:id/file", createFile);
router.post("/workspace/:id/folder", createFolder);
router.patch("/workspace/:id/entry", renameEntry);
router.delete("/workspace/:id/entry", deleteEntry);

/* --------------------------------------------------- code sent person to person */

// Same six routes on all three panels — the controller works out who is asking
router.get("/code-share/people", listPeople);
router.get("/code-share/sent", listSent);
router.get("/code-share/received", listReceived);
router.post("/code-share", uploadZip, sendPackage);
router.get("/code-share/:id/download", downloadPackage);
router.delete("/code-share/:id", removePackage);

/* ------------------------------------------------------------------ code */

// The admin is the only authority here: employees submit, this panel reviews
// the code and decides who it goes to.
router.get("/code", adminListSubmissions);
router.get("/code/:id/download", downloadSubmission);
router.get("/code/:id", getSubmission);
router.put("/code/:id/review", reviewSubmission);
router.post("/code/:id/share", shareSubmission);
router.delete("/code/:id/share/:userId", revokeShare);

/* ------------------------------------------------------------------ chat */

router.get("/chat/rooms/:scope", getRooms);
router.get("/chat/:scope/:roomId", getMessages);
router.post("/chat/:scope/:roomId", sendMessage);

/* --------------------------------------------------------- notifications */

/**
 * Deliberately outside the module guards above, like /me and /lookups.
 * An inbox is how this account is told what is happening to it, not a
 * section of the app it can be given or denied — an admin who cannot open
 * Clients should still be told a client is waiting on them.
 *
 * "read-all" sits above "/:id/read" or it would be read as a notification id.
 */
router.put("/notifications/read-all", markAllRead);
router.get("/notifications", listNotifications);
router.put("/notifications/:id/read", markNotificationRead);

/* --------------------------------------------------------------- reports */

router.get("/reports", getReports);

/* --------------------------------------------------------- activity logs */

router.get("/activity-logs", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);

    const query = {};
    if (req.query.action && req.query.action !== "all") query.action = req.query.action;
    if (req.query.entity && req.query.entity !== "all") query.entity = req.query.entity;
    if (req.query.search) {
      const regex = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ message: regex }, { actorName: regex }];
    }

    const [items, total] = await Promise.all([
      ActivityLog.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      ActivityLog.countDocuments(query),
    ]);

    return res.status(200).json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error("activity logs error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* --------------------------------------------------- roles & permissions */

const roles = buildCrud(Role, {
  entity: "Role",
  searchFields: ["name", "key", "description"],
});

router.get("/roles/meta", (req, res) =>
  res.status(200).json({ modules: PERMISSION_MODULES, actions: PERMISSION_ACTIONS })
);
router.get("/roles", roles.list);
router.post("/roles", roles.create);
router.get("/roles/:id", roles.getOne);
router.put("/roles/:id", roles.update);

// A role somebody holds cannot be deleted: permissionsFor() fails closed on a
// dangling reference, so deleting one would lock its holders out rather than
// free them.
router.delete("/roles/:id", async (req, res) => {
  const inUse = await roleIsInUse(req.params.id);
  if (inUse) {
    return res.status(400).json({
      message: `${inUse} administrator${inUse === 1 ? "" : "s"} still hold${
        inUse === 1 ? "s" : ""
      } this role — reassign them first`,
    });
  }
  return roles.remove(req, res);
});

/* ------------------------------------------------------- administrators */

// Who is a super admin, and which permission role each admin holds. Super
// admin only: this is the screen that decides what everybody else can reach.
router.get("/administrators", requireSuperAdmin, listAdministrators);
router.put("/administrators/:id", requireSuperAdmin, updateAdministrator);

/* ------------------------------------------------ settings & own profile */

router.get("/settings", getSettings);
router.put("/settings", updateSettings);
router.put("/profile", updateProfile);
router.put("/profile/password", changePassword);

/* --------------------------------------------------- dropdown lookups */

router.get("/lookups", async (req, res) => {
  try {
    const [clientList, leaderList, employeeList, projectList] = await Promise.all([
      Client.find().select("name company").sort({ name: 1 }),
      User.find({ role: "team_leader" }).select("name designation").sort({ name: 1 }),
      // reportsTo lets the Assign Team screen flag members who sit under a
      // different leader — that leader could not give them work.
      User.find({ role: "employee" })
        .select("name designation reportsTo")
        .populate("reportsTo", "name")
        .sort({ name: 1 }),
      // The team travels with the project so the task form can offer only the
      // people who are actually on it.
      Project.find()
        .select("name code teamLeader members")
        .populate("teamLeader", "name designation")
        .populate("members", "name designation")
        .sort({ name: 1 }),
    ]);

    return res.status(200).json({
      clients: clientList,
      teamLeaders: leaderList,
      employees: employeeList,
      projects: projectList,
      staff: [...leaderList, ...employeeList],
    });
  } catch (err) {
    console.error("lookups error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;

/* ------------------------------------------------------------ google play */

/**
 * Everything under /play is one module in the permission matrix. Consoles,
 * apps, releases and policy notices are one job done by one group of people —
 * splitting them into four toggles would only produce roles that can see an
 * app but not what shipped on it.
 */

router.get("/play/overview", playOverview);

router.get("/play/consoles", consoles.list);
router.post("/play/consoles", consoles.create);
router.get("/play/consoles/:id", consoles.getOne);
router.put("/play/consoles/:id", consoles.update);
router.delete("/play/consoles/:id", removeConsole);

router.get("/play/apps", apps.list);
router.post("/play/apps", apps.create);
// Ahead of "/play/apps/:id" so "detail" is never read as an id
router.get("/play/apps/:id/detail", appDetail);
router.get("/play/apps/:id/releases", listReleases);
router.post("/play/apps/:id/releases", createRelease);
router.put("/play/apps/:id/releases/:releaseId", updateRelease);
router.delete("/play/apps/:id/releases/:releaseId", removeRelease);
router.get("/play/apps/:id", apps.getOne);
router.put("/play/apps/:id", apps.update);
router.delete("/play/apps/:id", removeApp);

router.get("/play/alerts", alerts.list);
router.post("/play/alerts", alerts.create);
router.get("/play/alerts/:id", alerts.getOne);
router.put("/play/alerts/:id", alerts.update);
router.delete("/play/alerts/:id", alerts.remove);

/* --------------------------------------------------------------- seo / smo */

/**
 * One module again, for the same reason /play is: rankings, audits, backlinks
 * and the post calendar are one retainer done by one group. A role that could
 * see keywords but not the audit they came from would be a role nobody wants.
 */

router.get("/seo/projects", seoProjects.list);
router.post("/seo/projects", seoProjects.create);
// Ahead of "/:id" so neither word is ever read as an id
router.get("/seo/projects/:id/detail", seoProjectDetail);
router.get("/seo/projects/:id/report", monthlyReport);
router.get("/seo/projects/:id/keywords", listKeywords);
router.post("/seo/projects/:id/keywords", addKeywords);
router.get("/seo/projects/:id/keywords/:keywordId", keywordHistory);
router.put("/seo/projects/:id/keywords/:keywordId", updateKeyword);
router.post("/seo/projects/:id/keywords/:keywordId/rank", recordRank);
router.delete("/seo/projects/:id/keywords/:keywordId", removeKeyword);
router.get("/seo/projects/:id", seoProjects.getOne);
router.put("/seo/projects/:id", seoProjects.update);
router.delete("/seo/projects/:id", seoProjects.remove);

router.get("/seo/audits", audits.list);
router.post("/seo/audits", audits.create);
router.get("/seo/audits/:id", audits.getOne);
router.put("/seo/audits/:id", audits.update);
router.put("/seo/audits/:id/issues/:issueId", updateAuditIssue);
router.delete("/seo/audits/:id", audits.remove);

router.get("/seo/backlinks", backlinks.list);
router.post("/seo/backlinks", backlinks.create);
router.post("/seo/backlinks/check", checkBacklinks);
router.get("/seo/backlinks/:id", backlinks.getOne);
router.put("/seo/backlinks/:id", backlinks.update);
router.delete("/seo/backlinks/:id", backlinks.remove);

router.get("/seo/social-accounts", socialAccounts.list);
router.post("/seo/social-accounts", socialAccounts.create);
router.post("/seo/social-accounts/:id/followers", recordFollowers);
router.get("/seo/social-accounts/:id", socialAccounts.getOne);
router.put("/seo/social-accounts/:id", socialAccounts.update);
router.delete("/seo/social-accounts/:id", socialAccounts.remove);

router.get("/seo/posts", socialPosts.list);
router.post("/seo/posts", socialPosts.create);
router.get("/seo/posts/:id", socialPosts.getOne);
router.put("/seo/posts/:id", socialPosts.update);
router.delete("/seo/posts/:id", socialPosts.remove);

/* ---------------------------------------------------------- crm & billing */

router.get("/crm/pipeline", pipeline);
router.get("/crm/receivables", receivables);

router.get("/crm/leads", leads.list);
router.post("/crm/leads", leads.create);
router.post("/crm/leads/:id/notes", addLeadNote);
router.post("/crm/leads/:id/convert", convertLead);
router.get("/crm/leads/:id", leads.getOne);
router.put("/crm/leads/:id", leads.update);
router.delete("/crm/leads/:id", leads.remove);

router.get("/crm/services", services.list);
router.post("/crm/services", services.create);
router.get("/crm/services/:id", services.getOne);
router.put("/crm/services/:id", services.update);
router.delete("/crm/services/:id", services.remove);

// The write paths are hand-written rather than generated: both carry a
// numbering scheme and tax arithmetic that buildCrud has no way to know about.
router.get("/crm/quotations", quotations.list);
router.post("/crm/quotations", createQuotation);
router.post("/crm/quotations/:id/invoice", quotationToInvoice);
router.get("/crm/quotations/:id", quotations.getOne);
router.put("/crm/quotations/:id", updateQuotation);
router.delete("/crm/quotations/:id", quotations.remove);

router.get("/crm/invoices", invoices.list);
router.post("/crm/invoices", createInvoice);
router.get("/crm/invoices/:id/detail", invoiceDetail);
router.post("/crm/invoices/:id/payments", addPayment);
router.delete("/crm/invoices/:id/payments/:paymentId", removePayment);
router.get("/crm/invoices/:id", invoices.getOne);
router.put("/crm/invoices/:id", updateInvoice);
router.delete("/crm/invoices/:id", invoices.remove);

/* ------------------------------------------------------------- the vault */

router.get("/vault", listCredentials);
router.post("/vault", createCredential);
// A POST, not a GET — see the handler for why — so it is guarded as the read
// it actually is rather than as the "create" its verb would imply.
router.post("/vault/:id/reveal", guardAction("vault", "view"), revealCredential);
router.get("/vault/:id/access-log", credentialAccessLog);
router.put("/vault/:id", updateCredential);
router.delete("/vault/:id", removeCredential);

/* --------------------------------------------------------- paid advertising */

router.get("/ads/overview", adsOverview);

router.get("/ads/accounts", adAccounts.list);
router.post("/ads/accounts", adAccounts.create);
// The named sub-paths sit above "/:id" so none of them is read as an id
router.get("/ads/accounts/:id/detail", accountDetail);
router.get("/ads/accounts/:id/report", periodReport);
router.get("/ads/accounts/:id/campaigns", listCampaigns);
router.post("/ads/accounts/:id/campaigns", createCampaign);
router.post("/ads/accounts/:id/import", importDays);
router.post("/ads/accounts/:id/topups", addTopup);
router.post("/ads/accounts/:id/bill", billPeriod);
router.get("/ads/accounts/:id/campaigns/:campaignId", campaignDetail);
router.put("/ads/accounts/:id/campaigns/:campaignId", updateCampaign);
router.delete("/ads/accounts/:id/campaigns/:campaignId", removeCampaign);
router.post("/ads/accounts/:id/campaigns/:campaignId/days", recordDay);
router.get("/ads/accounts/:id", adAccounts.getOne);
router.put("/ads/accounts/:id", adAccounts.update);
router.delete("/ads/accounts/:id", adAccounts.remove);

/* ------------------------------------------------------- our own portfolio */

/**
 * Apps and sites the studio owns rather than builds to order. Its own module
 * because access to it is a question about the studio's own money, not about
 * which client work somebody handles.
 */

router.get("/portfolio", portfolio);

router.get("/portfolio/properties", properties.list);
router.post("/portfolio/properties", properties.create);
// Named sub-paths ahead of "/:id" so none of them is read as an id
router.get("/portfolio/properties/:id/detail", propertyDetail);
router.get("/portfolio/properties/:id/history", propertyHistory);
router.get("/portfolio/properties/:id/entries", listEntries);
router.post("/portfolio/properties/:id/entries", addEntry);
router.put("/portfolio/properties/:id/entries/:entryId", updateEntry);
router.delete("/portfolio/properties/:id/entries/:entryId", removeEntry);
router.get("/portfolio/properties/:id/payouts", listPayouts);
router.post("/portfolio/properties/:id/partners/:partnerId/pay", payPartner);
router.get("/portfolio/properties/:id", properties.getOne);
router.put("/portfolio/properties/:id", properties.update);
router.delete("/portfolio/properties/:id", properties.remove);
