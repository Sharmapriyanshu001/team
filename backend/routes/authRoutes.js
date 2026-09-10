import express from "express";

import { login } from "../controllers/authController.js";
import { loginBurstLimiter, loginLimiter } from "../middleware/security.js";

/**
 * The one login everybody uses.
 *
 * Deliberately tiny and deliberately unauthenticated — it is the only route in
 * the app that has to answer before anybody has a session. Everything it hands
 * back is what the browser needs to store one and go to the right panel; what
 * that session then unlocks is decided by each panel's own middleware, exactly
 * as before.
 *
 * The same two rate limiters every per-panel login carries: a burst limiter for
 * the rapid-fire attempt and a slower one for the patient guess. This endpoint
 * needs them more than those did, because it is now the single address worth
 * attacking.
 */
const router = express.Router();

router.post("/login", loginBurstLimiter, loginLimiter, login);

export default router;
