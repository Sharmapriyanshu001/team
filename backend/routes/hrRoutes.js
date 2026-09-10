import express from "express";

import hrAuth, { hrGuard, requireHrAdmin } from "../middleware/hrAuth.js";
import {
  listNotifications,
  markAllRead,
  markNotificationRead,
} from "../controllers/hr/notificationController.js";
import {
  departmentManagerSummary,
  departmentManagers,
} from "../controllers/hr/departmentManagerController.js";
import {
  operationsManagerSummary,
  operationsManagers,
} from "../controllers/hr/operationsManagerController.js";
import {
  createSalesManager,
  getSalesManager,
  listSalesManagers,
  removeSalesManager,
  updateSalesManager,
} from "../controllers/hr/salesManagerController.js";
import {
  getClientRecord,
  listClientRecords,
} from "../controllers/hr/clientRecordController.js";
import {
  addAdjustment,
  employeeIncentive,
  getRules,
  listIncentives,
  removeAdjustment,
  updateRules,
} from "../controllers/hr/incentiveController.js";
import { loginBurstLimiter, loginLimiter } from "../middleware/security.js";

import {
  changePassword,
  getSettings,
  hrLogin,
  hrLogout,
  hrProfile,
  updateProfile,
} from "../controllers/hr/authController.js";
import {
  createManager,
  getManager,
  listManagers,
  removeManager,
  updateManager,
} from "../controllers/hr/managerController.js";
import {
  documentRegister,
  hrReports,
  newStaff,
  saveStaffPaperwork,
  serveDocument,
  staff,
  staffDetails,
} from "../controllers/hr/peopleController.js";
import { uploadStaffDocuments } from "../utils/uploads.js";
import { discardUploadsIfRefused } from "../utils/staffDocuments.js";
import { removeStaff } from "../utils/staffCrud.js";
import {
  hiringDashboard,
  hiringLookups,
  listInterviews,
  listOnboarding,
  moveStage,
  openingDetail,
  openings,
  updateOnboarding,
} from "../controllers/hr/hiringController.js";

import {
  getAttendanceSheet,
  getAttendanceSummary,
  saveAttendance,
} from "../controllers/attendanceController.js";

/**
 * The HR panel's own routes, shared with the admin panel where the work is
 * genuinely the same — leave, policies and candidates are one set of records
 * with one set of rules, and giving HR a second implementation of them would
 * be two things to keep in step and one of them quietly wrong.
 */
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
import { teams } from "../controllers/teamController.js";
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
  addPayment as addSalaryPayment,
  getSalary,
  removePayment as removeSalaryPayment,
  setDailyRate,
} from "../controllers/salaryController.js";

const router = express.Router();

/* ------------------------------------------------------------------ auth */

router.post("/login", loginBurstLimiter, loginLimiter, hrLogin);
router.post("/logout", hrAuth, hrLogout);

/**
 * Everything below needs an HR token.
 *
 * This is the boundary the whole panel rests on: there is no route in this
 * file that touches a lead, an invoice, a project, the vault or the roles, so
 * an HR account cannot reach any of them however its access is configured.
 * The same token is refused by adminAuth, leaderAuth, employeeAuth and
 * clientAuth alike — HR is not in any of their role lists.
 */
router.use(hrAuth);

router.get("/me", hrProfile);
router.put("/profile", updateProfile);
router.put("/profile/password", changePassword);

/* ------------------------------------------------------------ permissions */

/**
 * Module guards, mounted on the path rather than per route, so a route added
 * later cannot quietly miss its check. The action comes from the HTTP verb —
 * see middleware/hrAuth.
 */
router.use("/dashboard", hrGuard("dashboard"));
router.use("/employees", hrGuard("employees"));
router.use("/staff", hrGuard("employees"));
router.use("/department-managers", hrGuard("department_managers"));
router.use("/operations-managers", hrGuard("operations_managers"));
router.use("/sales-managers", hrGuard("sales_managers"));
router.use("/client-records", hrGuard("client_records"));
router.use("/incentives", hrGuard("incentives"));
router.use("/incentive-rules", hrGuard("incentives"));
router.use("/attendance", hrGuard("attendance"));
router.use("/leaves", hrGuard("leaves"));
router.use("/leave-policies", hrGuard("leaves"));
router.use("/candidates", hrGuard("candidates"));
router.use("/hiring", hrGuard("hiring"));
router.use("/documents", hrGuard("documents"));
router.use("/reports", hrGuard("reports"));
router.use("/departments", hrGuard("departments"));
router.use("/settings", hrGuard("settings"));

/**
 * The HR logins themselves: guarded by module and then closed to everybody but
 * the head outright. An HR Manager who could create HR accounts could create
 * another head, so this is a role check rather than a permission.
 */
router.use("/managers", hrGuard("hr_managers"), requireHrAdmin);

/* ------------------------------------------------------------- dashboard */

// The same figures the admin panel's HR overview shows, from the same query
router.get("/dashboard", hrOverview);

/* ------------------------------------------------------------- employees */

// Named sub-paths ahead of "/:id" so neither is read as an id
router.get("/employees/:id/details", staffDetails);

/* ---------------------------------------------------------------- salary */

/**
 * What a day of somebody's work is worth, what the attendance sheet says they
 * have earned, and what has actually been handed over.
 *
 * Earnings are computed from the sheet on every read rather than stored — see
 * utils/salary.js — so correcting a day corrects the wage bill. Only the daily
 * rate and the individual payments are written down.
 *
 * Mounted here and in the admin panel and nowhere else. An operations
 * manager knowing what their team is paid changes a working relationship, and
 * that is a decision for the company rather than a side effect of a route.
 */
router.get("/staff/:id/salary", getSalary);
router.put("/staff/:id/salary/rate", setDailyRate);
router.post("/staff/:id/salary/payments", addSalaryPayment);
router.delete("/staff/:id/salary/payments/:paymentId", removeSalaryPayment);

/**
 * The onboarding file — identity cards, bank details, previous employment,
 * and the scans behind them. A multipart request, so it carries the upload
 * middleware; `discardUploadsIfRefused` deletes the bytes again if the guard
 * above turns the request away, rather than leaving them on disk forever.
 */
router.put(
  "/employees/:id/documents",
  uploadStaffDocuments,
  discardUploadsIfRefused,
  saveStaffPaperwork
);
router.get("/employees", staff.list);
router.get("/employees/:id", staff.getOne);
router.put("/employees/:id", staff.update);

/**
 * Hiring one directly.
 *
 * Multipart like the admin panel's, so the Aadhaar and PAN scans can come with
 * the form — a plain JSON body still works, since multer leaves one alone, and
 * none of the paperwork is required to create the account. See
 * controllers/hr/peopleController.js for why this is a different crud from the
 * three routes above it.
 *
 * The permission was already there: HR holds create on the employees module,
 * and has since the panel was built. Only the route was missing.
 */
router.post("/employees", uploadStaffDocuments, discardUploadsIfRefused, newStaff.create);

/**
 * Deleting is still deliberately absent, not hidden. It takes somebody's name
 * off every task, leave and team they ever touched; setting them inactive is
 * the reversible answer and is an ordinary edit from here. The irreversible
 * one stays an administrator's call from the admin panel.
 */

/* ------------------------------------------------------------ attendance */

router.get("/attendance/summary", getAttendanceSummary);
router.get("/attendance", getAttendanceSheet);
router.post("/attendance", saveAttendance);

/* ----------------------------------------------------------------- leave */

router.get("/leaves/balances", leaveBalances);
router.get("/leaves", leaves.list);
router.post("/leaves", leaves.create);
// A PUT so the guard asks for "edit leaves" rather than "create"
router.put("/leaves/:id/decide", decideLeave);
router.get("/leaves/:id", leaves.getOne);
router.put("/leaves/:id", leaves.update);
router.delete("/leaves/:id", leaves.remove);

router.get("/leave-policies", leavePolicies.list);
router.post("/leave-policies", leavePolicies.create);
router.get("/leave-policies/:id", leavePolicies.getOne);
router.put("/leave-policies/:id", leavePolicies.update);
router.delete("/leave-policies/:id", leavePolicies.remove);

/* ----------------------------------------------- recruitment & candidates */

router.get("/candidates", candidates.list);
router.post("/candidates", candidates.create);
/**
 * Hiring creates the person's staff account, which is why it is a route and
 * not a stage the edit form can set. hrController refuses "hired" on a plain
 * update for exactly that reason, and refuses a hire into any department role
 * unless an administrator is asking — so an HR account cannot mint a
 * colleague this way and walk around requireHrAdmin.
 */
/**
 * Multipart, because the hire form carries the new joiner's CV. Every field
 * on it is still optional, so a hire sent as plain JSON — which is what every
 * caller did before the CV box existed — goes through untouched.
 */
router.post(
  "/candidates/:id/hire",
  uploadStaffDocuments,
  discardUploadsIfRefused,
  hireCandidate
);
router.post("/candidates/:id/interviews", addInterview);
router.put("/candidates/:id/interviews/:interviewId", updateInterview);
router.delete("/candidates/:id/interviews/:interviewId", removeInterview);
router.get("/candidates/:id", candidates.getOne);
router.put("/candidates/:id", candidates.update);
router.delete("/candidates/:id", candidates.remove);

/* ---------------------------------------------------------------- hiring */

/**
 * The chain, in the order it runs:
 *
 *   Job Opening → Candidate → Interview → Shortlisted → Selected
 *                                                          ↓
 *                                       Employee ← Onboarding
 *
 * Candidates and their interview rounds keep the routes they already had —
 * /candidates is one set of records with one set of rules, and giving Hiring a
 * second copy of them would be two things to keep in step. What is new here is
 * the vacancy they hang off, the decisions between interview and offer, and
 * the onboarding that ends in an account.
 */

router.get("/hiring/dashboard", hiringDashboard);
router.get("/hiring/lookups", hiringLookups);

// Named sub-paths ahead of "/:id" so none of them is read as an id
router.get("/hiring/openings/:id/detail", openingDetail);
router.get("/hiring/openings", openings.list);
router.post("/hiring/openings", openings.create);
router.get("/hiring/openings/:id", openings.getOne);
router.put("/hiring/openings/:id", openings.update);
router.delete("/hiring/openings/:id", openings.remove);

router.get("/hiring/interviews", listInterviews);

/**
 * Moving somebody along. A PUT so the guard asks for "edit hiring" rather
 * than "create", and its own route because it is the change that has to be
 * recorded — and because it refuses "hired", which belongs to onboarding.
 */
router.put("/hiring/candidates/:id/stage", moveStage);

router.get("/hiring/onboarding", listOnboarding);
router.put("/hiring/onboarding/:id", updateOnboarding);

/* ------------------------------------------------------------- documents */

router.get("/documents", documentRegister);
router.get("/documents/:id/:field", serveDocument);

/* --------------------------------------------------------------- reports */

router.get("/reports", hrReports);

/* -------------------------------------------------------------- settings */

router.get("/settings", getSettings);

/* ---------------------------------------------------------- HR accounts */

router.get("/managers", listManagers);
router.post("/managers", createManager);
router.get("/managers/:id", getManager);
router.put("/managers/:id", updateManager);
router.delete("/managers/:id", removeManager);

/* --------------------------------------------------------- notifications */

/**
 * Ungated on purpose, exactly as in the admin panel: an inbox is how this
 * account is told what is happening to it, not a section that can be granted
 * or withheld. An HR Manager and the HR head both get their own.
 *
 * "read-all" is declared above "/:id/read" so the word is never read as an id.
 */
router.get("/notifications", listNotifications);
router.put("/notifications/read-all", markAllRead);
router.put("/notifications/:id/read", markNotificationRead);

/* --------------------------------------------------- department managers */

/**
 * The department heads who run a team and sign in to the operations manager panel.
 *
 * Same records and same helpers as the admin panel's Managers screen, so a
 * manager HR opens here is not a second kind of "manager" that behaves
 * differently. staffCrudOptions forces role:"manager" on every write, so no
 * request body can turn this into a way to create an administrator.
 *
 * "summary" sits above "/:id" so the word is not read as an id.
 */
router.get("/department-managers/summary", departmentManagerSummary);
router.get("/department-managers", departmentManagers.list);
router.post(
  "/department-managers",
  uploadStaffDocuments,
  discardUploadsIfRefused,
  departmentManagers.create
);
router.get("/department-managers/:id", departmentManagers.getOne);
router.put(
  "/department-managers/:id",
  uploadStaffDocuments,
  discardUploadsIfRefused,
  departmentManagers.update
);

/**
 * Closing the account for good.
 *
 * The same handler the admin panel deletes staff through, so a manager removed
 * by HR is removed exactly as one removed by an administrator — their scans
 * and their previous-employment papers come off the disk with them rather than
 * being orphaned in uploads/.
 *
 * Deactivating remains the ordinary answer and the screen offers it first;
 * this is the deliberate one, and it asks before it happens.
 */
router.delete("/department-managers/:id", removeStaff("manager", departmentManagers));

/* --------------------------------------------------- operations managers */

/**
 * The operations managers who run the projects, and whom the employees report
 * to. HR could open a department head's login here but not one of these, which
 * left the hire HR makes most often as the one it had to ask an administrator
 * for.
 *
 * Same records and same helpers as the admin panel's Operations Managers
 * screen — staffCrudOptions forces role:"operations_manager" on every write,
 * so no request body can turn this into a way to create an administrator.
 *
 * "summary" sits above "/:id" so the word is not read as an id.
 */
router.get("/operations-managers/summary", operationsManagerSummary);
router.get("/operations-managers", operationsManagers.list);
router.post(
  "/operations-managers",
  uploadStaffDocuments,
  discardUploadsIfRefused,
  operationsManagers.create
);
router.get("/operations-managers/:id", operationsManagers.getOne);
router.put(
  "/operations-managers/:id",
  uploadStaffDocuments,
  discardUploadsIfRefused,
  operationsManagers.update
);

/**
 * Closing the account for good — the same handler the admin panel deletes
 * staff through, so their scans and previous-employment papers come off the
 * disk with them rather than being orphaned in uploads/.
 *
 * Deactivating remains the ordinary answer and the screen offers it first.
 */
router.delete(
  "/operations-managers/:id",
  removeStaff("operations_manager", operationsManagers)
);

/* ------------------------------------------------------- the reporting chain */

/**
 * Team Member → Manager → HR → Admin, and the answer back down.
 *
 * The same handlers serve every panel — the direction of travel is worked out
 * from who is asking, not from which door they came through. See
 * controllers/reportChainController.js.
 *
 * Named sub-paths ahead of "/:id" so none of them is read as a report id.
 */
router.get("/reports/context", reportContext);
router.get("/reports/mine", myReports);
router.get("/reports/inbox", reportInbox);
router.get("/reports/departments", departmentPerformance);
router.get("/reports/org", orgChart);
router.post("/reports", submitReport);
router.put("/reports/:id/review", reviewReport);
router.put("/reports/:id/respond", respondToReport);
router.get("/reports/:id", reportDetail);
router.delete("/reports/:id", withdrawReport);

/* ---------------------------------------------------------- departments */

/**
 * Opening a department, and correcting one.
 *
 * The same Team records the admin panel's Teams board manages — one kind of
 * record, two doors onto it — so a department HR opens behaves identically to
 * one an administrator opens, and appears on the same org chart, targets and
 * reports without anything being kept in step by hand.
 *
 * No delete. Removing a department detaches every target, report and member
 * filed against it, which stays an administrator's call; the guard refuses it
 * anyway, since HR holds create and edit on this module rather than all four.
 * Closing one down is an edit — set it inactive.
 */
router.get("/departments", teams.list);
router.post("/departments", teams.create);
router.get("/departments/:id", teams.getOne);
router.put("/departments/:id", teams.update);

/* -------------------------------------------------------- sales managers */

/**
 * The Sales panel's logins, opened and closed by HR.
 *
 * The same accounts the administrator creates from Department Accounts and
 * the Sales head manages from their own team screen — one kind of record,
 * three doors onto it. The role is validated against the sales roles and
 * nothing else, so this cannot mint an administrator or an HR account.
 *
 * Deleting is refused while the person still owns live deals; that check is
 * in the controller, where the pipeline can actually be counted.
 */
router.get("/sales-managers", listSalesManagers);
router.post("/sales-managers", createSalesManager);
router.get("/sales-managers/:id", getSalesManager);
router.put("/sales-managers/:id", updateSalesManager);
router.delete("/sales-managers/:id", removeSalesManager);

/* --------------------------------------------------------- client records */

/**
 * Client details Sales has sent through.
 *
 * Read-only, and it lists only what somebody in Sales deliberately shared —
 * not every client in the company. A client nobody sent is answered as
 * missing rather than refused, because HR has no business learning which
 * clients exist but were not shared.
 */
router.get("/client-records", listClientRecords);
router.get("/client-records/:id", getClientRecord);

/* ------------------------------------------------------------ incentive */

/**
 * The points scheme that decides the bonus.
 *
 * Points are worked out from the tasks rather than banked when work is
 * done — see utils/incentive.js for why — so there is no route here that
 * "awards" a task. What a person can do is adjust, with a reason, and
 * change the rules.
 *
 * "adjust" and "rules" are declared above "/:employeeId" so neither word is
 * read as a person's id.
 */
router.post("/incentives/adjust", addAdjustment);
router.delete("/incentives/adjust/:id", removeAdjustment);

router.get("/incentives", listIncentives);
router.get("/incentives/:employeeId", employeeIncentive);

router.get("/incentive-rules", getRules);
router.put("/incentive-rules", updateRules);

export default router;
