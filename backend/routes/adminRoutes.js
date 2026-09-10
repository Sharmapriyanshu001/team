import fs from "fs";
import express from "express";

import adminAuth from "../middleware/adminAuth.js";
import { loginBurstLimiter, loginLimiter } from "../middleware/security.js";
import {
  guard,
  guardAction,
  requireFullAdmin,
  requireSuperAdmin,
} from "../middleware/permissions.js";
import {
  listAdministrators,
  updateAdministrator,
  roleIsInUse,
} from "../controllers/administratorController.js";
import { buildCrud, InvalidInput } from "../utils/crud.js";
import {
  removeStaff,
  resolveLoginPassword,
  staffCrudOptions,
  staffDocument,
} from "../utils/staffCrud.js";
import { hashPassword } from "../utils/password.js";
import { notifyUser } from "../utils/notify.js";

import User, { DEPARTMENT_ROLES } from "../models/User.js";
import Client from "../models/Client.js";
import Project from "../models/Project.js";
import Task from "../models/Task.js";
import Issue from "../models/Issue.js";
import FileDoc from "../models/FileDoc.js";
import ActivityLog from "../models/ActivityLog.js";
import Role, {
  MODULE_DEPARTMENTS,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
} from "../models/Role.js";

import { adminLogin, adminLogout, adminProfile } from "../controllers/adminController.js";
import {
  addInterview,
  candidates,
  decideLeave,
  hireCandidate,
  hrOverview,
  leaveBalances,
  leavePolicies,
  leaves,
  removeInterview,
  updateInterview,
} from "../controllers/hrController.js";
import {
  createDepartmentAccount,
  departmentMeta,
  getDepartmentAccount,
  listDepartmentAccounts,
  removeDepartmentAccount,
  updateDepartmentAccount,
} from "../controllers/departmentAccountController.js";
import {
  departmentPerformance,
  myReports,
  orgChart,
  reportContext,
  reportDetail,
  reportInbox,
  respondToReport,
  reviewReport,
  submitReport,
  withdrawReport,
} from "../controllers/reportChainController.js";
import {
  client360,
  handOverClient,
  pendingHandover,
} from "../controllers/client360Controller.js";
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
  teams,
  teamDetail,
  teamsOverview,
  listTargets,
  setTarget,
  updateTarget,
  removeTarget,
  targetMetrics,
} from "../controllers/teamController.js";
import {
  listCredentials,
  createCredential,
  updateCredential,
  removeCredential,
  revealCredential,
  credentialAccessLog,
} from "../controllers/vaultController.js";
import {
  operationsManagerPerformance,
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
import { taskLinkFor } from "../utils/taskLink.js";
import { syncAssignments } from "../utils/projectTeam.js";
import { logActivity } from "../utils/activity.js";
import {
  getSettings,
  updateSettings,
  updateProfile,
  changePassword,
} from "../controllers/settingsController.js";
import {
  projectPayments,
  projectPaymentsOverview,
} from "../controllers/projectPaymentController.js";
import {
  assignChangeRequest,
  countNewChangeRequests,
  getChangeRequest,
  listChangeRequests,
  updateChangeRequest,
} from "../controllers/changeRequestController.js";
import { bonusByProject, listBonuses } from "../controllers/bonusController.js";
import {
  addPayment as addSalaryPayment,
  getSalary,
  removePayment as removeSalaryPayment,
  setDailyRate,
} from "../controllers/salaryController.js";

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
router.use("/operations-managers", guard("operations_managers"));
router.use("/managers", guard("operations_managers"));
router.use("/employees", guard("employees"));
router.use("/staff", guard("employees"));
router.use("/attendance", guard("employees"));
/**
 * HR's own two modules, kept apart from the employee directory.
 *
 * Being allowed to see who works here is not the same decision as being
 * allowed to read everyone's leave reasons or the salary a candidate asked
 * for, and rolling them together would have meant every manager who can open
 * the staff list could open those too.
 *
 * The overview sits under "employees" because it is a headcount summary, and
 * it is what an HR account lands on.
 */
router.use("/hr/overview", guard("employees"));
router.use("/hr/leaves", guard("leaves"));
router.use("/hr/leave-policies", guard("leaves"));
router.use("/hr/candidates", guard("recruitment"));
/**
 * The department logins themselves. Guarded by module like everything else and
 * then closed to department accounts outright — an account that can mint
 * accounts can grant itself any module, so a role is not enough here.
 */
router.use("/department-accounts", guard("department_accounts"), requireFullAdmin);
router.use("/projects", guard("projects"));
/**
 * Client change requests sit under the projects module rather than earning one
 * of their own: a request is a thing that happens to a project, and anybody
 * who may not see the project has no business reading what its client asked
 * for. Splitting them would mean two answers to one question.
 */
router.use("/change-requests", guard("projects"));
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
/**
 * Project money sits behind the CRM permission, not the projects one.
 *
 * Somebody who runs delivery needs the project; they do not thereby need the
 * client's GST number, the payment references or what is still owed. The two
 * are separate decisions, so they are separate modules — and this route exists
 * in no other panel's router, which is what keeps it out of reach of Sales,
 * HR, an operations manager and the client rather than merely refused to them.
 */
router.use("/project-payments", guard("crm"));
router.use("/ads", guard("ads"));
router.use("/portfolio", guard("portfolio"));
router.use("/teams", guard("teams"));
router.use("/targets", guard("teams"));
router.use("/vault", guard("vault"));
router.use("/reports", guard("reports"));
router.use("/activity-logs", guard("activity_logs"));
// Editing the roles is editing what everybody may do, so it is closed to
// department accounts however wide their own role happens to be. The module
// guard would already refuse them; this makes it impossible to grant by
// mistake from the role editor itself.
router.use("/roles", guard("roles"), requireFullAdmin);
router.use("/settings", guard("settings"));

router.get("/dashboard", getDashboard);
router.get("/insights/:metric", getInsight);

/* --------------------------------------------------------------- helpers */

/**
 * Staff helpers live in utils/staffCrud.js because the HR panel manages the
 * same people from its own routes. See that file for why they are shared
 * rather than copied.
 */

// Strip empty ObjectId-ish fields so Mongoose does not throw a CastError.
const cleanRefs = (fields) => (payload) => {
  const data = { ...payload };
  fields.forEach((field) => {
    if (data[field] === "" || data[field] === null) delete data[field];
  });
  return data;
};

/**
 * A reference somebody is allowed to remove.
 *
 * cleanRefs deletes an empty value rather than writing it, which is right on a
 * create — an unfilled <select> must not be cast to an ObjectId — and wrong on
 * an edit, where clearing the field is the whole intent. Deleting it there
 * means the update simply leaves the old value in place, so the link comes
 * back and the person who cleared it is not told.
 *
 * This says the difference explicitly: on an update, an empty value that was
 * actually sent becomes null.
 */
const clearOnUpdate = (data, payload, existing, fields) => {
  if (!existing) return data;

  fields.forEach((field) => {
    const sent = payload[field];
    if (sent === "" || sent === null) data[field] = null;
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
  populate: [{ path: "previousProject", select: "name code status endDate" }],
  beforeSave: (payload, req, existing) => {
    // An empty <select> must not be cast to an ObjectId
    // An empty <select> must not be cast to an ObjectId on a create — but on
    // an edit, answering "no" after "yes" has to actually remove the link
    const data = clearOnUpdate(
      cleanRefs(["previousProject"])(payload),
      payload,
      existing,
      ["previousProject"]
    );
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

/**
 * Won, and nobody in Operations has picked it up. Declared above "/:id" so
 * that path is not read as a client id — the same reason every other named
 * sub-path in this file sits where it does.
 */
router.get("/clients/pending-handover", pendingHandover);

/** Everything about one client, from every department at once. */
router.get("/clients/:id/360", client360);

/**
 * Sales hands the client to Operations.
 *
 * A PUT rather than a POST on purpose: the group guard above turns the verb
 * into the permission it demands, and this changes an existing client rather
 * than creating one. As a POST it would ask for "create clients" and tell
 * somebody who pressed Hand over that they may not add clients.
 */
router.put("/clients/:id/handover", handOverClient);

router.get("/clients/:id/details", clientDetails);
router.get("/clients/:id", clients.getOne);
router.put("/clients/:id", clients.update);
router.delete("/clients/:id", clients.remove);

/* -------------------------------------------------------------- meetings */

// What clients have asked for, and the join link on each one
router.get("/meetings", listMeetings);
router.post("/meetings/:id/link", regenerateLink);
router.put("/meetings/:id", updateMeeting);

/* --------------------------------------------------------- operations managers */

const operationsManagers = buildCrud(User, staffCrudOptions("operations_manager"));

router.get("/operations-managers/performance", operationsManagerPerformance);
router.get("/operations-managers", operationsManagers.list);

/**
 * The add form sends four steps at once, so these two take multipart: the
 * details and the bank fields as text, the Aadhaar and PAN scans as files.
 * A plain JSON body still works — multer leaves one alone — so nothing that
 * posted to these before has to change.
 */
router.post(
  "/operations-managers",
  uploadStaffDocuments,
  discardUploadsIfRefused,
  operationsManagers.create
);

router.get("/operations-managers/:id/details", staffDetails("operations_manager"));
router.get("/operations-managers/:id/documents/:field", staffDocument("operations_manager"));
router.get("/operations-managers/:id", operationsManagers.getOne);

router.put(
  "/operations-managers/:id",
  uploadStaffDocuments,
  discardUploadsIfRefused,
  operationsManagers.update
);

router.delete("/operations-managers/:id", removeStaff("operations_manager", operationsManagers));

/* -------------------------------------------------------------- managers */

/**
 * Department heads. The same record and the same form as an operations manager —
 * what differs is what they answer for, not what is on file about them.
 *
 * Guarded by the operations_managers module rather than one of its own: both are
 * senior staff, and a role allowed to manage one and not the other would be a
 * distinction nobody asked for.
 *
 * A manager can also be created the other way round, by being made manager of
 * a team, which promotes whatever account they already had — see
 * teamController. This is the path for hiring one directly.
 */
const managers = buildCrud(User, staffCrudOptions("manager"));

router.get("/managers", managers.list);
router.post("/managers", uploadStaffDocuments, discardUploadsIfRefused, managers.create);

router.get("/managers/:id/details", staffDetails("manager"));
router.get("/managers/:id/documents/:field", staffDocument("manager"));
router.get("/managers/:id", managers.getOne);

router.put("/managers/:id", uploadStaffDocuments, discardUploadsIfRefused, managers.update);
router.delete("/managers/:id", removeStaff("manager", managers));

/* ------------------------------------------------------------- employees */

const employees = buildCrud(User, staffCrudOptions("employee"));

router.get("/employees/performance", employeePerformance);
router.get("/employees", employees.list);

// Same four-step form, same paperwork — see the operations manager routes above
router.post("/employees", uploadStaffDocuments, discardUploadsIfRefused, employees.create);

router.get("/employees/:id/details", staffDetails("employee"));

/* ---------------------------------------------------------------- salary */

/**
 * What a day of somebody's work is worth, what the attendance sheet says they
 * have earned, and what has actually been handed over.
 *
 * Earnings are computed from the sheet on every read rather than stored — see
 * utils/salary.js — so correcting a day corrects the wage bill. Only the daily
 * rate and the individual payments are written down.
 *
 * Mounted here and in the HR panel and nowhere else. An operations
 * manager knowing what their team is paid changes a working relationship, and
 * that is a decision for the company rather than a side effect of a route.
 */
router.get("/staff/:id/salary", getSalary);
router.put("/staff/:id/salary/rate", setDailyRate);
router.post("/staff/:id/salary/payments", addSalaryPayment);
router.delete("/staff/:id/salary/payments/:paymentId", removeSalaryPayment);

router.get("/employees/:id/documents/:field", staffDocument("employee"));
router.get("/employees/:id", employees.getOne);

router.put("/employees/:id", uploadStaffDocuments, discardUploadsIfRefused, employees.update);

router.delete("/employees/:id", removeStaff("employee", employees));

/* ------------------------------------------------------------ attendance */

router.get("/attendance/summary", getAttendanceSummary);
router.get("/attendance", getAttendanceSheet);
router.post("/attendance", saveAttendance);

/* ------------------------------------------------------------------- HR */

/**
 * Leave, and hiring.
 *
 * Both of these had real rows sitting in this database and no code in this
 * build that could read them — an earlier version wrote them and left no
 * models behind. The models match those documents field for field rather than
 * being designed fresh, so the applications and candidates already on file
 * turn up here instead of being stranded.
 */

router.get("/hr/overview", hrOverview);

// Named sub-paths ahead of "/:id" so neither is read as an id
router.get("/hr/leaves/balances", leaveBalances);
router.get("/hr/leaves", leaves.list);
router.post("/hr/leaves", leaves.create);
/**
 * Deciding is its own route rather than a field on the edit, because it is the
 * one change that has to record who made it — and a PUT, so the group guard
 * asks for "edit leaves" rather than "create".
 */
router.put("/hr/leaves/:id/decide", decideLeave);
router.get("/hr/leaves/:id", leaves.getOne);
router.put("/hr/leaves/:id", leaves.update);
router.delete("/hr/leaves/:id", leaves.remove);

router.get("/hr/leave-policies", leavePolicies.list);
router.post("/hr/leave-policies", leavePolicies.create);
router.get("/hr/leave-policies/:id", leavePolicies.getOne);
router.put("/hr/leave-policies/:id", leavePolicies.update);
router.delete("/hr/leave-policies/:id", leavePolicies.remove);

router.get("/hr/candidates", candidates.list);
router.post("/hr/candidates", candidates.create);
/**
 * Hiring creates a staff account with a login, which is why it is a route and
 * not a stage the edit form can set — see hrController, which refuses the
 * stage on a plain update for exactly that reason.
 */
/** Multipart for the same reason as the HR panel's copy: the CV comes with it. */
router.post(
  "/hr/candidates/:id/hire",
  uploadStaffDocuments,
  discardUploadsIfRefused,
  hireCandidate
);
router.post("/hr/candidates/:id/interviews", addInterview);
router.put("/hr/candidates/:id/interviews/:interviewId", updateInterview);
router.delete("/hr/candidates/:id/interviews/:interviewId", removeInterview);
router.get("/hr/candidates/:id", candidates.getOne);
router.put("/hr/candidates/:id", candidates.update);
router.delete("/hr/candidates/:id", candidates.remove);

/* --------------------------------------------------- department accounts */

/**
 * The HR, Sales and Operations logins.
 *
 * Deliberately no ceiling on how many of each may exist: ten HR accounts is
 * ten people who each answer for what they did, and one shared HR login is an
 * audit trail that never names anybody.
 */

router.get("/department-accounts/meta", departmentMeta);
router.get("/department-accounts", listDepartmentAccounts);
router.post("/department-accounts", createDepartmentAccount);
router.get("/department-accounts/:id", getDepartmentAccount);
router.put("/department-accounts/:id", updateDepartmentAccount);
router.delete("/department-accounts/:id", removeDepartmentAccount);

/* -------------------------------------------------------------- projects */

/* ------------------------------------- "have we built this before?" */

const HAS_SCHEME = /^https?:\/\//i;
// "acme.com", "acme.co.uk/portal", "sub.acme.dev?ref=1" — a paste with the
// scheme left off, which is what a browser address bar hands over these days
const LOOKS_LIKE_HOST = /^[\w-]+(\.[\w-]+)+([/?#]|$)/;

/**
 * The answer given while a project is being created, and the link behind it.
 *
 * Three rules, all of them about the answer still meaning something a year
 * later:
 *
 *   a "yes" must carry a link      otherwise it is a note to nobody
 *   a "no" clears the link         so an answer changed from yes to no does
 *                                  not leave last week's URL sitting under it
 *   a link is stored usable        "acme.com" pasted from an address bar is
 *                                  stored as "https://acme.com", because a
 *                                  link that cannot be clicked is a string
 *
 * A path is allowed through as it is: somebody linking to another project on
 * this panel pastes "/admin/projects/<id>", and turning that into a hostname
 * would break it.
 *
 * Returns undefined when the request said nothing about it, which is how an
 * edit of any other field leaves the answer alone.
 */
const readExistingWork = (raw) => {
  if (raw === undefined || raw === null) return undefined;

  const asked = raw.builtBefore;
  const builtBefore =
    asked === true || asked === "true" ? true : asked === false || asked === "false" ? false : null;

  const link = String(raw.link || "").trim();
  const note = String(raw.note || "").trim();

  if (builtBefore !== true) return { builtBefore, link: "", note };

  if (!link) {
    throw new InvalidInput("Paste the link to what was built before, or answer No");
  }

  const usable = HAS_SCHEME.test(link) || link.startsWith("/")
    ? link
    : LOOKS_LIKE_HOST.test(link)
      ? `https://${link}`
      : "";

  if (!usable) {
    throw new InvalidInput("That does not look like a link — paste the full address");
  }

  return { builtBefore: true, link: usable, note };
};

const projects = buildCrud(Project, {
  entity: "Project",
  searchFields: ["name", "code", "description"],
  filterFields: ["status", "priority", "client", "operationsManager"],
  populate: [
    { path: "client", select: "name company" },
    { path: "operationsManager", select: "name email designation" },
    { path: "members", select: "name email designation" },
    // What this job continues from, so the list and the detail can say so
    { path: "previousProject", select: "name code status endDate" },
  ],

  /**
   * A new project inherits the client's "we built for them before" answer.
   *
   * That answer is given once, on the client record, and this is what makes it
   * mean something afterwards — otherwise an admin would have to remember it
   * and re-select the old job on every project they create for that client,
   * which is exactly the sort of thing that gets done for the first project
   * and forgotten by the third.
   *
   * Only on create, and only when the request has not said otherwise: a
   * project can be pointed at a different predecessor, or at none, and an edit
   * that clears the link must not have it silently put back.
   */
  beforeSave: async (payload, req, existing) => {
    const data = clearOnUpdate(
      cleanRefs(["client", "operationsManager", "startDate", "endDate", "previousProject"])(payload),
      payload,
      existing,
      ["previousProject"]
    );

    if (!existing && data.previousProject === undefined && data.client) {
      const client = await Client.findById(data.client).select("previousProject");
      if (client?.previousProject) data.previousProject = client.previousProject;
    }

    // Left alone when the request said nothing about it, so editing a budget
    // cannot wipe the answer
    const existingWork = readExistingWork(payload.existingWork);
    if (existingWork !== undefined) data.existingWork = existingWork;

    return data;
  },
  /**
   * Tell everybody whose project this just became — or stopped being.
   *
   * The leader has always been told. The members never were: an admin adding
   * three people to a project from Assign Team sent nothing to any of them,
   * and the only way they found out was noticing a new project in their list.
   * The leader's own assign flow has always notified and always written down
   * who did the adding; this brings the admin's path in line with it.
   */
  afterSave: async (project, req, { isNew, previous }) => {
    const actor = req.admin || req.hr;

    /* ----------------------------------------------------------- the lead */

    const changedLeader = String(previous?.operationsManager || "") !== String(project.operationsManager || "");

    if (project.operationsManager && (isNew || changedLeader)) {
      notifyUser(project.operationsManager, {
        type: "project",
        title: isNew ? "New project assigned" : "You now lead this project",
        message: `"${project.name}" — ${project.status.replace(/_/g, " ")}`,
        link: "/operation-manager/projects/active",
      });
    }

    /* -------------------------------------------------------- the members */

    const before = new Set((previous?.members || []).map(String));
    const now = new Set((project.members || []).map(String));

    const added = [...now].filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !now.has(id));

    if (!added.length && !removed.length) return;

    added.forEach((id) =>
      notifyUser(id, {
        type: "project",
        title: "You have been added to a project",
        message: `"${project.name}" — ${project.status.replace(/_/g, " ")}`,
        link: "/employee/projects/active",
      })
    );

    removed.forEach((id) =>
      notifyUser(id, {
        type: "project",
        title: "You have been taken off a project",
        message: `"${project.name}"`,
        link: "/employee/projects/active",
      })
    );

    /**
     * And who did it, kept on the project itself.
     *
     * Written after the save rather than in beforeSave so it reads the
     * membership that was actually stored, and saved on its own so a failure
     * here cannot lose the assignment the admin just made.
     */
    /**
     * Run on a removal too, not only on an addition.
     *
     * `syncAssignments` drops records for people no longer on the project as
     * well as writing new ones — gating it on `added.length` meant taking
     * somebody off left their record behind, so the project went on saying
     * who had assigned a person who was not on it any more.
     * Unconditional here because the early return above already established
     * that the membership changed one way or the other.
     */
    await Project.updateOne(
      { _id: project._id },
      {
        $set: {
          memberAssignments: syncAssignments(
            previous?.memberAssignments || [],
            project.members || [],
            actor
          ),
        },
      }
    ).catch((err) => console.error("project assignment record error:", err.message));

    logActivity(req, {
      action: "updated",
      entity: "Project",
      entityId: project._id,
      message: `${actor?.name || "An admin"} ${
        added.length ? `added ${added.length} ` : ""
      }${added.length && removed.length ? "and " : ""}${
        removed.length ? `removed ${removed.length} ` : ""
      }on "${project.name}"`,
    });
  },
});

router.get("/projects", projects.list);
router.post("/projects", projects.create);
router.get("/projects/:id/details", projectDetails);
router.get("/projects/:id", projects.getOne);
router.put("/projects/:id", projects.update);
router.delete("/projects/:id", projects.remove);

/* ------------------------------------------------------------- bonuses */

/**
 * Money promised on individual tasks, and whether it was earned. Under the
 * tasks module rather than CRM: it is a cost of doing the work and belongs to
 * whoever runs the work, unlike the client's invoices.
 */
router.get("/bonuses/projects", bonusByProject);
router.get("/bonuses", listBonuses);

/* ------------------------------------------------------ project payments */

/**
 * What each project is worth, what has been billed, and what has come in.
 * Assembled from the invoices rather than stored on the project — see
 * controllers/projectPaymentController.js for why those are different numbers.
 */
router.get("/project-payments", projectPaymentsOverview);
router.get("/project-payments/:id", projectPayments);

/* ------------------------------------------------------- change requests */

/**
 * Everything every client has asked to be changed, and the whole history of
 * each — which is what "the admin can monitor it" has to mean if it is to be
 * worth anything. The same handlers the client, employee and leader panels
 * use; the scope they get is the difference, and it is decided from the token
 * rather than the route. See controllers/changeRequestController.js.
 */
router.get("/change-requests/new-count", countNewChangeRequests);
router.get("/change-requests", listChangeRequests);
router.get("/change-requests/:id", getChangeRequest);
router.put("/change-requests/:id", updateChangeRequest);
router.put("/change-requests/:id/assign", assignChangeRequest);

/* ----------------------------------------------------------------- tasks */

const tasks = buildCrud(Task, {
  entity: "Task",
  searchFields: ["title", "description"],
  // Department work is filterable the same way a project's is — that is the
  // whole point of the admin seeing both
  filterFields: ["status", "priority", "project", "team", "assignedTo"],
  populate: [
    { path: "project", select: "name code" },
    { path: "team", select: "name kind" },
    { path: "assignedTo", select: "name email designation" },
  ],
  label: (doc) => doc?.title,
  beforeSave: (payload, req, existing) => {
    const data = cleanRefs(["project", "team", "assignedTo", "assignedBy", "dueDate"])(payload);
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
    // Work handed to someone has to reach them, whether they are an operations manager
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
          link: taskLinkFor(assignee.role),
        });
      }
    }

    // A task moving into review needs the project's leader to sign it off
    if (task.status !== "review" || previous?.status === "review") return;

    const project = await Project.findById(task.project).select("name operationsManager");
    if (!project?.operationsManager) return;

    notifyUser(project.operationsManager, {
      type: "review",
      title: "Work waiting for review",
      message: `"${task.title}" on ${project.name}`,
      link: "/operation-manager/daily-review",
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

    const project = await Project.findById(issue.project).select("name operationsManager");
    if (!project?.operationsManager) return;

    notifyUser(project.operationsManager, {
      type: "issue",
      title: `New ${issue.severity} issue`,
      message: `"${issue.title}" on ${project.name}`,
      link: "/operation-manager/issues",
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
 * The request queue: what operations managers and employees have asked the admin to
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


/* ------------------------------------------------------- the reporting chain */

/**
 * The top of the chain: Team Member → Manager → HR → Admin.
 *
 * An administrator reads every HR report and answers it, and can follow any
 * one of them down to the individual week that produced a figure. The same
 * handlers serve all four panels — see controllers/reportChainController.js.
 *
 * Guarded as "reports", the module the existing Reports screen already uses,
 * so an admin who can see reports can see these and no new grant is needed.
 */
router.get("/reports/chain/context", reportContext);
router.get("/reports/chain/mine", myReports);
router.get("/reports/chain/inbox", reportInbox);
router.get("/reports/chain/departments", departmentPerformance);
router.get("/reports/chain/org", orgChart);
router.post("/reports/chain", submitReport);
router.put("/reports/chain/:id/review", reviewReport);
router.put("/reports/chain/:id/respond", respondToReport);
router.get("/reports/chain/:id", reportDetail);
router.delete("/reports/chain/:id", withdrawReport);
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
  res.status(200).json({
    modules: PERMISSION_MODULES,
    actions: PERMISSION_ACTIONS,
    // Which department each module belongs to, so the role editor can group
    // twenty-five checkboxes into the four headings a person thinks in
    departments: MODULE_DEPARTMENTS,
  })
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
    const [clientList, managerList, leaderList, employeeList, projectList] = await Promise.all([
      Client.find().select("name company").sort({ name: 1 }),
      /**
       * Managers belong in `staff` too. Leaving them out was a real hole: the
       * moment somebody was made a department head their role changed, and
       * they vanished from every dropdown in the panel — no longer assignable
       * to a task, a lead, or another team.
       */
      User.find({ role: "manager" }).select("name designation").sort({ name: 1 }),
      User.find({ role: "operations_manager" }).select("name designation").sort({ name: 1 }),
      // reportsTo lets the Assign Team screen flag members who sit under a
      // different leader — that leader could not give them work.
      User.find({ role: "employee" })
        .select("name designation reportsTo")
        .populate("reportsTo", "name")
        .sort({ name: 1 }),
      // The team travels with the project so the task form can offer only the
      // people who are actually on it.
      Project.find()
        .select("name code operationsManager members")
        .populate("operationsManager", "name designation")
        .populate("members", "name designation")
        .sort({ name: 1 }),
    ]);

    /**
     * Department accounts belong in `staff` for the same reason managers were
     * added to it: the moment somebody is made an HR or Sales account they
     * would otherwise vanish from every dropdown in the panel — unassignable
     * to a task, a lead or a candidate, despite being a person who works here.
     *
     * They are also returned on their own, because the handover form needs to
     * offer Operations specifically rather than everybody.
     */
    const departmentList = await User.find({ role: { $in: DEPARTMENT_ROLES }, status: "active" })
      .select("name designation role")
      .sort({ name: 1 });

    const operationsStaff = [
      ...departmentList.filter((person) => person.role === "operations"),
      ...managerList,
      ...leaderList,
    ];

    return res.status(200).json({
      clients: clientList,
      managers: managerList,
      operationsManagers: leaderList,
      employees: employeeList,
      projects: projectList,
      departmentAccounts: departmentList,
      // Who a client can be handed over to: Operations accounts, then the
      // managers and operations managers who actually run delivery
      operationsStaff,
      staff: [...departmentList, ...managerList, ...leaderList, ...employeeList],
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

/* -------------------------------------------------------- teams & targets */

/**
 * One module covering both. A department and the numbers it carries are the
 * same conversation — a role that could see who is on Sales but not what Sales
 * is meant to bring in would be a role nobody wants.
 */

router.get("/teams/overview", teamsOverview);
router.get("/teams/metrics", targetMetrics);

router.get("/teams", teams.list);
router.post("/teams", teams.create);
router.get("/teams/:id/detail", teamDetail);
router.get("/teams/:id", teams.getOne);
router.put("/teams/:id", teams.update);
router.delete("/teams/:id", teams.remove);

router.get("/targets", listTargets);
router.post("/targets", setTarget);
router.put("/targets/:id", updateTarget);
router.delete("/targets/:id", removeTarget);
