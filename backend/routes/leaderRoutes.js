import express from "express";

import leaderAuth from "../middleware/leaderAuth.js";
import {
  myPlayWork,
  myAppDetail,
  staffCreateRelease,
} from "../controllers/playConsoleController.js";
import { mySeoWork } from "../controllers/seoController.js";
import { myCredentials, revealCredential } from "../controllers/vaultController.js";
import { myAdsWork, myAccountDetail, staffRecordDay } from "../controllers/adsController.js";
import { myTeam } from "../controllers/teamController.js";
import { loginBurstLimiter, loginLimiter } from "../middleware/security.js";
import {
  leaderLogin,
  leaderLogout,
  leaderProfile,
  updateProfile,
  changePassword,
} from "../controllers/leader/authController.js";
import { getDashboard } from "../controllers/leader/dashboardController.js";
import {
  listProjects,
  getProject,
  updateProgress,
  getProgressBoard,
} from "../controllers/leader/projectController.js";
import {
  getAssignBoard,
  updateProjectMembers,
  shareCodeProjectWithTeam,
} from "../controllers/leader/assignController.js";
import { listTeam, teamPerformance } from "../controllers/leader/teamController.js";
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  removeTask,
  getReviewQueue,
  reviewTask,
  countNewTasks,
  markTasksSeen,
} from "../controllers/leader/taskController.js";
import { getRooms, getMessages, sendMessage } from "../controllers/leader/chatController.js";
import {
  listSharedWithMe,
  getSubmission,
  downloadSubmission,
  listReviewQueue,
  reviewAsLeader,
} from "../controllers/codeShareController.js";
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
  listMyCodeProjects,
  getMyCodeProject,
  getMyCodeProjectTree,
  downloadOriginalZip,
  softDeleteMyCodeProject,
} from "../controllers/codeProjectController.js";
import {
  createRequest,
  listMyRequests,
  cancelMyRequest,
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
  // Aliased: this router already imports a createFile for the Files section,
  // which is the FileDoc record, not a file inside a workspace.
  createFile as createWorkspaceFile,
  createFolder,
  renameEntry,
  deleteEntry,
  searchWorkspace,
} from "../controllers/workspaceFileController.js";
import {
  listVersions,
  createVersion,
  downloadVersion,
} from "../controllers/projectVersionController.js";
import { uploadZip } from "../utils/uploads.js";
import { downloadFile, completeFile } from "../controllers/fileAssignmentController.js";
import {
  listFiles,
  createFile,
  removeFile,
  listIssues,
  createIssue,
  updateIssue,
  getCalendar,
  listNotifications,
  markNotificationRead,
  markAllRead,
  getReports,
  getLookups,
} from "../controllers/leader/workspaceController.js";

const router = express.Router();

// Guessing a password is the one attack this endpoint cannot refuse on
// its own merits, so it is throttled rather than argued with.
router.post("/login", loginBurstLimiter, loginLimiter, leaderLogin);
// Ending a session is something only a live session can ask for, so this
// sits behind the same door as everything else rather than beside the login.
router.post("/logout", leaderAuth, leaderLogout);

// Everything below this line needs a valid team leader token
router.use(leaderAuth);

router.get("/me", leaderProfile);
router.put("/profile", updateProfile);
router.put("/profile/password", changePassword);

router.get("/dashboard", getDashboard);

/* -------------------------------------------------------------- projects */

/**
 * Assign Work — handing a project the admin gave this leader down to their
 * own team. The board is one call because the screen is useless in pieces.
 *
 * Putting somebody on a project is what makes it appear on their screen at
 * all, so this is the missing middle of admin → leader → employee. It is
 * working access only: the client, the budget, the deadline and who owns
 * the project are not writable from this panel and never were.
 */
router.get("/assign-work", getAssignBoard);
router.put("/projects/:id/members", updateProjectMembers);

router.get("/progress", getProgressBoard);
router.get("/projects", listProjects);
router.get("/projects/:id", getProject);
router.put("/projects/:id/progress", updateProgress);

/* ------------------------------------------------------------------ team */

router.get("/team/performance", teamPerformance);
router.get("/team", listTeam);

/* ----------------------------------------------------------------- tasks */

router.get("/review", getReviewQueue);
router.put("/review/:id", reviewTask);

router.get("/tasks", listTasks);
router.post("/tasks", createTask);
// Both sit above /tasks/:id, or "new-count" and "seen" get read as task ids
router.get("/tasks/new-count", countNewTasks);
router.put("/tasks/seen", markTasksSeen);
router.get("/tasks/:id", getTask);
router.put("/tasks/:id", updateTask);
router.delete("/tasks/:id", removeTask);

/* ------------------------------------------------------------------ chat */

router.get("/chat/rooms/:tab", getRooms);
router.get("/chat/:tab/:roomId", getMessages);
router.post("/chat/:tab/:roomId", sendMessage);

/* ------------------------------------------------------------------ code */

/**
 * Two different things live under /code, and they are not the same list.
 *
 * The review queue is work this leader's own team submitted to them: they
 * may read every version of it, including ones nobody has approved, because
 * that is what reviewing means.
 *
 * Everything else here is still what it was — what the admin explicitly
 * shared, approved versions only, never their team's submissions by default.
 *
 * "/code/review" sits above "/code/:id" or it is read as a submission id.
 */
router.get("/code/review", listReviewQueue);
router.put("/code/:id/review", reviewAsLeader);

router.get("/code", listSharedWithMe);
router.get("/code/:id/download", downloadSubmission);
router.get("/code/:id", getSubmission);

/* -------------------------------------------------------------- code projects */

// Read-only, and only what the admin assigned to this leader in person. The
// controller re-checks the assignment on every one of these — being on the
// route is not permission.
/**
 * Sending code down with the work.
 *
 * A leader uploads a ZIP against one of their own projects and it becomes a
 * workspace their people open in the browser — the same thing the admin's
 * upload makes, through the same handler, because the extraction has no
 * business having two implementations.
 *
 * The handler holds the limits: it must be a project this leader runs, they
 * are the only team leader on it, and the per-project permissions take their
 * defaults rather than anything sent here.
 */
router.post("/code-projects", uploadZip, createCodeProject);

router.get("/code-projects", listMyCodeProjects);

/**
 * Asking the admin to change or delete a project.
 *
 * This is not a way round the read-only rule above — a request is a row in a
 * collection, and nothing here touches a project. The admin's decision does,
 * from their own router. What this replaces is asking over chat and hoping.
 *
 * "requests" sits above "/:id" or it gets read as a project id.
 */
router.get("/code-projects/requests", listMyRequests);
router.delete("/code-projects/requests/:requestId", cancelMyRequest);
router.post("/code-projects/:id/requests", createRequest);

// History is readable, and a snapshot is takeable with canEdit. Restoring is
// deliberately absent: it would throw away everyone else's work on the project.
router.get("/code-projects/:id/versions", listVersions);
router.post("/code-projects/:id/versions", createVersion);
router.get("/code-projects/:id/versions/:version/archive", downloadVersion);

// The archive as uploaded, so work can be taken to a local editor. The
// handler checks the assignment itself.
router.get("/code-projects/:id/archive", downloadOriginalZip);

router.get("/code-projects/:id/tree", getMyCodeProjectTree);
router.get("/code-projects/:id", getMyCodeProject);

// Sharing a workspace this leader already holds with their own team. They
// cannot add a team leader, cannot touch the per-project permissions, and
// cannot reach a code project the admin did not assign to them.
router.put("/code-projects/:id/employees", shareCodeProjectWithTeam);

/**
 * Deleting the project itself.
 *
 * Soft, always: the record is flagged and the project moves to a bin only an
 * admin can open. Nothing on disk is touched, the assignment is left alone,
 * and the admin can put it back. The route that actually destroys a project
 * exists only on the admin router.
 *
 * Not to be confused with deleting a file inside the workspace, which is the
 * /workspace/:id/entry route below and leaves the project entirely alone.
 */
router.delete("/code-projects/:id", softDeleteMyCodeProject);

// The workspace. Editing is gated on the project's own canEdit permission,
// which the controller reads — not on which route this is.
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
router.post("/workspace/:id/file", createWorkspaceFile);
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

/* ------------------------------------------------- files, issues, agenda */

router.get("/files", listFiles);
router.post("/files", createFile);
router.get("/files/:id/download", downloadFile);
router.put("/files/:id/complete", completeFile);
router.delete("/files/:id", removeFile);

router.get("/issues", listIssues);
router.post("/issues", createIssue);
router.put("/issues/:id", updateIssue);

router.get("/calendar", getCalendar);

router.put("/notifications/read-all", markAllRead);
router.get("/notifications", listNotifications);
router.put("/notifications/:id/read", markNotificationRead);

router.get("/reports", getReports);
router.get("/lookups", getLookups);

export default router;

/* ------------------------------------------------------------ google play */

/**
 * What this account has been put on, and nothing else. The controller decides
 * scope from the id arrays rather than trusting anything in the request, so
 * these three routes need no guard of their own.
 */
router.get("/play/my-work", myPlayWork);
router.get("/play/apps/:id", myAppDetail);
// Recording what shipped is the work itself, so staff may add a release
router.post("/play/apps/:id/releases", staffCreateRelease);

/* ---------------------------------------------------------------- seo work */

router.get("/seo/my-work", mySeoWork);

/* ------------------------------------------------------------- the vault */

/**
 * Only what has been shared with this account, and the secret only when asked
 * for by name. revealCredential checks sharedWith itself for anyone who is not
 * an admin, and writes down who looked.
 */
router.get("/vault", myCredentials);
router.post("/vault/:id/reveal", revealCredential);

/* --------------------------------------------------------- paid advertising */

/**
 * The accounts this person is on, and the numbers for them. No money position:
 * what the studio is owed, or what is left of a client's advance, is between
 * the admin and the client.
 */
router.get("/ads/my-work", myAdsWork);
router.get("/ads/accounts/:id", myAccountDetail);
router.post("/ads/campaigns/:campaignId/days", staffRecordDay);

/* ------------------------------------------------------------- my team */

/** The teams this account is on, and the targets it carries this month. */
router.get("/team/mine", myTeam);
