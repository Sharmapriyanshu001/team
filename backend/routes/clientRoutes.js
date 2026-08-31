import express from "express";

import clientAuth from "../middleware/clientAuth.js";
import { loginBurstLimiter, loginLimiter } from "../middleware/security.js";
import {
  clientLogin,
  clientLogout,
  clientProfile,
  updateProfile,
  changePassword,
} from "../controllers/client/authController.js";
import { getDashboard } from "../controllers/client/dashboardController.js";
import { getRooms, getMessages, sendMessage } from "../controllers/client/chatController.js";
import {
  listProjects,
  getProgress,
  listFiles,
  listFeedback,
  createFeedback,
  listMeetings,
  requestMeeting,
  cancelMeeting,
  listNotifications,
  markNotificationRead,
  markAllRead,
  getLookups,
} from "../controllers/client/workspaceController.js";

const router = express.Router();

// Guessing a password is the one attack this endpoint cannot refuse on
// its own merits, so it is throttled rather than argued with.
router.post("/login", loginBurstLimiter, loginLimiter, clientLogin);
// Ending a session is something only a live session can ask for, so this
// sits behind the same door as everything else rather than beside the login.
router.post("/logout", clientAuth, clientLogout);

// Everything below this line needs a valid client token
router.use(clientAuth);

router.get("/me", clientProfile);
router.put("/profile", updateProfile);
router.put("/profile/password", changePassword);

router.get("/dashboard", getDashboard);
router.get("/projects", listProjects);
router.get("/progress", getProgress);
router.get("/files", listFiles);

/* -------------------------------------------------- feedback & meetings */

router.get("/feedback", listFeedback);
router.post("/feedback", createFeedback);

router.get("/meetings", listMeetings);
router.post("/meetings", requestMeeting);
router.put("/meetings/:id/cancel", cancelMeeting);

/* ------------------------------------------------------------------ chat */

router.get("/chat/rooms/:tab", getRooms);
router.get("/chat/:tab/:roomId", getMessages);
router.post("/chat/:tab/:roomId", sendMessage);

/* --------------------------------------------------------- notifications */

router.put("/notifications/read-all", markAllRead);
router.get("/notifications", listNotifications);
router.put("/notifications/:id/read", markNotificationRead);

router.get("/lookups", getLookups);

export default router;
