import express from "express";

import employeeAuth from "../middleware/employeeAuth.js";
import {
  myPlayWork,
  myAppDetail,
  staffCreateRelease,
} from "../controllers/playConsoleController.js";
import { mySeoWork } from "../controllers/seoController.js";
import { loginBurstLimiter, loginLimiter } from "../middleware/security.js";
import {
  employeeLogin,
  employeeLogout,
  employeeProfile,
  updateProfile,
  changePassword,
} from "../controllers/employee/authController.js";
import { getDashboard } from "../controllers/employee/dashboardController.js";
import {
  listTasks,
  getTask,
  updateTaskStatus,
  countNewTasks,
  markTasksSeen,
  getDailyWork,
  saveDailyWork,
  submitDailyWork,
  getWorkHistory,
} from "../controllers/employee/taskController.js";
import { getRooms, getMessages, sendMessage } from "../controllers/employee/chatController.js";
import {
  submitCode,
  addVersion,
  listMySubmissions,
  listSharedWithMe,
  getSubmission,
  downloadSubmission,
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
} from "../controllers/projectVersionController.js";
import { uploadZip } from "../utils/uploads.js";
import { downloadFile, completeFile } from "../controllers/fileAssignmentController.js";
import { getAssignedWork } from "../controllers/employee/assignedController.js";
import {
  listProjects,
  listFiles,
  listIssues,
  createIssue,
  updateIssue,
  getCalendar,
  listNotifications,
  markNotificationRead,
  markAllRead,
  getLookups,
} from "../controllers/employee/workspaceController.js";

const router = express.Router();

// Guessing a password is the one attack this endpoint cannot refuse on
// its own merits, so it is throttled rather than argued with.
router.post("/login", loginBurstLimiter, loginLimiter, employeeLogin);
// Ending a session is something only a live session can ask for, so this
// sits behind the same door as everything else rather than beside the login.
router.post("/logout", employeeAuth, employeeLogout);

// Everything below this line needs a valid employee token
router.use(employeeAuth);

router.get("/me", employeeProfile);
router.put("/profile", updateProfile);
router.put("/profile/password", changePassword);

router.get("/dashboard", getDashboard);
router.get("/projects", listProjects);

/**
 * Everything a team leader has handed them, grouped and dated.
 *
 * Reads only what this account can already reach — their projects, their
 * tasks, the workspaces they were given. It is a different arrangement of
 * the same rows, not a wider one.
 */
router.get("/assigned", getAssignedWork);

/* ----------------------------------------------------------------- tasks */

router.get("/daily-work", getDailyWork);
router.post("/daily-work", saveDailyWork);
router.post("/daily-submit", submitDailyWork);
router.get("/history", getWorkHistory);

router.get("/tasks", listTasks);
// Both sit above /tasks/:id, or "new-count" and "seen" get read as task ids
router.get("/tasks/new-count", countNewTasks);
router.put("/tasks/seen", markTasksSeen);
router.get("/tasks/:id", getTask);
router.put("/tasks/:id", updateTaskStatus);

/* ------------------------------------------------------------------ chat */

router.get("/chat/rooms/:tab", getRooms);
router.get("/chat/:tab/:roomId", getMessages);
router.post("/chat/:tab/:roomId", sendMessage);

/* ------------------------------------------------------------------ code */

// "/shared" sits above "/:id" so it is not read as a submission id
router.get("/code/shared", listSharedWithMe);
router.get("/code", listMySubmissions);
router.post("/code", submitCode);
router.post("/code/:id/versions", addVersion);
router.get("/code/:id/download", downloadSubmission);
router.get("/code/:id", getSubmission);

/* -------------------------------------------------------------- code projects */

// Read-only, and only what the admin assigned to this employee. The controller
// re-checks the assignment on every one of these — being on the route is not
// permission.
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

/* ------------------------------------------------- files, issues, agenda */

router.get("/files", listFiles);
router.get("/files/:id/download", downloadFile);
router.put("/files/:id/complete", completeFile);

router.get("/issues", listIssues);
router.post("/issues", createIssue);
router.put("/issues/:id", updateIssue);

router.get("/calendar", getCalendar);

router.put("/notifications/read-all", markAllRead);
router.get("/notifications", listNotifications);
router.put("/notifications/:id/read", markNotificationRead);

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
