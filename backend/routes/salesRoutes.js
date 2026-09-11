import express from "express";

import {
  myLeavePolicies,
  myLeaves,
  applyForLeave,
  myLeaveDetail,
  withdrawLeave,
} from "../controllers/employee/leaveController.js";
import salesAuth, {
  requireSalesHead,
  salesGuard,
  salesGuardAction,
} from "../middleware/salesAuth.js";
import { loginBurstLimiter, loginLimiter } from "../middleware/security.js";

import {
  changeSalesPassword,
  salesLogin,
  salesLogout,
  salesProfile,
  updateSalesProfile,
} from "../controllers/sales/authController.js";
import {
  claimSalesMember,
  createSalesMember,
  getSalesMember,
  listSalesTeam,
  removeSalesMember,
  salesTeamOptions,
  updateSalesMember,
} from "../controllers/sales/teamController.js";
import {
  assignProject,
  deliveryTeam,
  listSalesProjects,
} from "../controllers/sales/projectController.js";
import {
  countNewTasks,
  createTask,
  getTask,
  listTasks,
  markTasksSeen,
  removeTask,
  updateTask,
} from "../controllers/sales/taskController.js";
import {
  addNote,
  assignLead,
  createLead,
  ensureLeadInScope,
  getLead,
  leadSources,
  listLeads,
  lostReasons,
  pipeline,
  setStage,
  updateLead,
} from "../controllers/sales/leadController.js";
import {
  completeFollowUp,
  createActivity,
  createFollowUp,
  createRequirement,
  listActivities,
  listFollowUps,
  listRequirements,
  removeFollowUp,
  removeRequirement,
  updateFollowUp,
  updateRequirement,
} from "../controllers/sales/engagementController.js";
import {
  createClient,
  getClient,
  handOver,
  handoverOptions,
  listClients,
  shareWithHr,
  startProject,
  updateClient,
} from "../controllers/sales/clientController.js";
import {
  salesDashboard,
  salesReports,
  salesRevenue,
} from "../controllers/sales/dashboardController.js";
import {
  listNotifications,
  markAllRead,
  markNotificationRead,
} from "../controllers/sales/notificationController.js";

import { convertLead, quotations, createQuotation, updateQuotation, quotationToInvoice, services } from "../controllers/crmController.js";

const router = express.Router();

/**
 * The Sales panel's API.
 *
 * Everything Sales does, and nothing else. There is no route under /api/sales
 * that reaches an employee's Aadhaar, a leave request, a code project or the
 * credential vault — so a sales account cannot reach HR, Operations or
 * administrator data by any request it is able to make. Not because a
 * permission says no, but because the door does not exist.
 *
 * The other half of that guarantee lives in models/User.js: sales roles are
 * not in ADMIN_PANEL_ROLES, so adminAuth refuses a sales token outright.
 *
 * Inside the panel there are two controls, and the second is the important one:
 *
 *   salesGuard(module)   which SCREENS this role has — coarse, by role
 *   req.salesScope       which ROWS those screens return — fine, by ownership
 *
 * An executive holds nearly every module a head does. What they do not hold is
 * everybody else's leads, and that is enforced in the queries — see
 * utils/salesAccess.js. Hiding a row has never been access control.
 */

/* ----------------------------------------------------------------- login */

/**
 * Rate limited harder than the rest of the API, in two layers: a burst limiter
 * for the rapid-fire attempt and a slower one for the patient guess. The same
 * pair every other panel's login carries.
 */
router.post("/login", loginBurstLimiter, loginLimiter, salesLogin);

// Everything below requires a valid sales session
router.use(salesAuth);

router.post("/logout", salesLogout);

/* --------------------------------------------------- profile & settings */

router.get("/me", salesProfile);
router.put("/me", updateSalesProfile);
router.put("/me/password", changeSalesPassword);

/* ---------------------------------------------------------------- guards */

/**
 * Mounted by path prefix rather than per route, so a route added under one of
 * these later cannot quietly miss its check. The action comes from the HTTP
 * verb — see middleware/salesAuth.js.
 *
 * Notifications are deliberately ungated, exactly as in the other panels: an
 * inbox is how this account is told what is happening to it, not a section
 * that can be granted or withheld.
 */
router.use("/dashboard", salesGuard("dashboard"));
router.use("/leads", salesGuard("leads"));
router.use("/followups", salesGuard("followups"));
router.use("/activities", salesGuard("activities"));
router.use("/requirements", salesGuard("requirements"));
router.use("/quotations", salesGuard("quotations"));
router.use("/clients", salesGuard("clients"));
router.use("/revenue", salesGuard("revenue"));
router.use("/reports", salesGuard("reports"));

/**
 * Department tasks. Mounted like the rest, and the verb mapping does the
 * separating on its own: an executive holds view and edit but not create or
 * delete, so they reach their own list and their own status change and are
 * refused the assign and the delete without a second guard being written.
 */
router.use("/tasks", salesGuard("tasks"));
router.use("/projects", salesGuard("projects"));

/**
 * The sales logins themselves. Guarded by module and then closed to
 * executives outright — an account that can mint accounts can promote itself,
 * so a module grant is not enough here.
 */
router.use("/team", salesGuard("team"), requireSalesHead);

/* ------------------------------------------------------------ dashboard */

router.get("/dashboard", salesDashboard);
router.get("/reports", salesReports);
router.get("/revenue", salesRevenue);

/* ---------------------------------------------------------------- team */

/**
 * "options" sits above "/:id" so the word is not read as an id, and is mounted
 * BEFORE the requireSalesHead group above would reach it — see the explicit
 * route below, which is declared outside /team for exactly that reason.
 */
router.get("/team", listSalesTeam);
router.post("/team", createSalesMember);
/**
 * Taking an unmanaged executive onto this manager's team. Above "/:id" so the
 * word is not read as an id, like every other named sub-path here.
 */
router.put("/team/:id/claim", claimSalesMember);

router.get("/team/:id", getSalesMember);
router.put("/team/:id", updateSalesMember);
router.delete("/team/:id", removeSalesMember);

/**
 * The "assign to" dropdown. Declared outside the /team prefix on purpose: an
 * executive handing a lead on needs the list of names, and /team is closed to
 * them. It returns names and roles only — no contact details, no pipeline.
 */
router.get("/people", salesTeamOptions);

/* ------------------------------------------------------------- projects */

/**
 * What Sales sold and Operations is delivering.
 *
 * Read for the whole floor, scoped to their own clients. The assignment is the
 * head's alone — requireSalesHead rather than the module grant, because the
 * verb here is an edit and an executive holds view on this module, so the
 * guard would let one through on its own.
 *
 * "delivery-team" sits outside the /projects prefix on purpose: it is the list
 * of names the assign form is built from, and it is the head who opens that
 * form.
 */
router.get("/projects", listSalesProjects);
router.get("/delivery-team", requireSalesHead, deliveryTeam);
router.put("/projects/:id/assign", requireSalesHead, assignProject);

/* ---------------------------------------------------------------- tasks */

/**
 * What a sales manager has handed to their team, and what each of them has
 * been handed. Same Task collection the rest of the app uses — see
 * controllers/sales/taskController.js for why there is no sales-only copy.
 *
 * The named sub-paths sit above "/:id" so neither is read as a task id.
 */
router.get("/tasks/new-count", countNewTasks);
router.put("/tasks/seen", markTasksSeen);

router.get("/tasks", listTasks);
router.post("/tasks", createTask);

router.get("/tasks/:id", getTask);
router.put("/tasks/:id", updateTask);
router.delete("/tasks/:id", removeTask);

/* ---------------------------------------------------------------- leads */

/**
 * Every named sub-path is declared above "/:id" so none of them is read as a
 * lead id — the same ordering rule the rest of this codebase follows.
 */
router.get("/leads/pipeline", pipeline);
router.get("/leads/sources", leadSources);
router.get("/leads/lost-reasons", lostReasons);

router.get("/leads", listLeads);
router.post("/leads", createLead);

router.get("/leads/:id", getLead);
router.put("/leads/:id", updateLead);

/** Moving a deal through the pipeline. Losing one demands a reason. */
router.put("/leads/:id/stage", setStage);

/** What was said. Appended, never replacing. */
router.post("/leads/:id/notes", addNote);

/**
 * Reassignment is a head's call — letting an executive pull a colleague's lead
 * onto their own name is how commission arguments start.
 */
router.put("/leads/:id/assign", requireSalesHead, assignLead);

/**
 * Lead → Client. The handler is crmController's, shared with the admin panel,
 * which has no notion of lead ownership — so the scope is checked first by the
 * middleware rather than forking a second copy of the conversion.
 *
 * guardAction because the verb lies: it is a POST, but what it performs on the
 * lead is an edit. Left to the verb it would demand "create leads" and tell
 * somebody who pressed Convert that they may not add leads.
 */
router.post(
  "/leads/:id/convert",
  salesGuardAction("leads", "edit"),
  ensureLeadInScope,
  convertLead
);

/* ----------------------------------------------------------- follow-ups */

router.get("/followups", listFollowUps);
router.post("/followups", createFollowUp);
router.put("/followups/:id/complete", completeFollowUp);
router.put("/followups/:id", updateFollowUp);
router.delete("/followups/:id", removeFollowUp);

/* ------------------------------------ calls, meetings and what was said */

router.get("/activities", listActivities);
router.post("/activities", createActivity);

/* ---------------------------------------------------------- requirements */

router.get("/requirements", listRequirements);
router.post("/requirements", createRequirement);
router.put("/requirements/:id", updateRequirement);
router.delete("/requirements/:id", removeRequirement);

/* ----------------------------------------------------------- quotations */

/**
 * The rate card and the quotation builder, reused verbatim from the admin
 * panel. A quotation Sales raises is the same record the admin sees, with the
 * same numbering and the same conversion to an invoice — there is no
 * sales-only copy that could drift from it.
 */
router.get("/quotations/services", services.list);
router.get("/quotations", quotations.list);
router.post("/quotations", createQuotation);
router.get("/quotations/:id", quotations.getOne);
router.put("/quotations/:id", updateQuotation);
/** Turning an accepted quotation into an invoice. A POST that creates one. */
router.post("/quotations/:id/invoice", quotationToInvoice);

/* --------------------------------------------------------------- clients */

/** Named sub-paths above "/:id", as everywhere else. */
router.get("/clients/handover-options", handoverOptions);

router.get("/clients", listClients);

/**
 * Adding a client without a lead in front of it.
 *
 * Converting a lead used to be the only way one could exist, which does not
 * match how a sales floor often actually wins work — somebody signs on the
 * spot, or arrives already agreed through a referral. The creator becomes
 * the owner, so it lands inside their own scope like everything else here.
 */
router.post("/clients", createClient);
router.get("/clients/:id", getClient);
router.put("/clients/:id", updateClient);

/** Turning a won deal into real work. */
router.post("/clients/:id/project", startProject);

/**
 * Send the client's details through to HR.
 *
 * Notifies every active HR account and stamps the client, because a
 * notification scrolls away and the question HR asks later is whether this
 * one has reached them at all. Re-sending is allowed: details change, and a
 * second send is how a correction travels.
 */
router.post("/clients/:id/share-hr", shareWithHr);

/**
 * Sales passes the account to Operations. A PUT rather than a POST because it
 * changes an existing client — as a POST the guard would demand "create
 * clients" and refuse somebody who only pressed Hand Over.
 */
router.put("/clients/:id/handover", handOver);

/* -------------------------------------------------------------- my leave */

/**
 * Somebody in Sales asking for their own time off.
 *
 * The same handlers the employee and operations manager panels use, scoped to
 * whoever is signed in. Not behind a salesGuard on purpose: those gate the
 * sales *resources* — leads, quotations, revenue — and a person's own leave is
 * not one of them. Notifications sit outside the guards for the same reason.
 *
 * Deciding stays with HR and the administrators on
 * PUT /api/hr/leaves/:id/decide. Nothing here approves anything.
 */
router.get("/leaves", myLeaves);
router.get("/leave-policies", myLeavePolicies);
router.post("/leaves", applyForLeave);
// Above "/leaves/:id", or "withdraw" is read as a request id
router.put("/leaves/:id/withdraw", withdrawLeave);
router.get("/leaves/:id", myLeaveDetail);

/* --------------------------------------------------------- notifications */

router.get("/notifications", listNotifications);
router.put("/notifications/read-all", markAllRead);
router.put("/notifications/:id/read", markNotificationRead);

export default router;
