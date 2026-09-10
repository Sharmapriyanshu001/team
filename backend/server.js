import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { initRealtime } from "./utils/realtime.js";
import { dropRoleCapIndexes } from "./utils/dbGuards.js";

import {
  apiLimiter,
  corsOptions,
  requestLogger,
  securityHeaders,
  trustProxy,
} from "./middleware/security.js";

import { servePreview, servePreviewSlug } from "./controllers/previewController.js";

import contactRoutes from "./routes/contactRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import hrRoutes from "./routes/hrRoutes.js";
import salesRoutes from "./routes/salesRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import leaderRoutes from "./routes/leaderRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";

dotenv.config();

/**
 * Every panel's session rests on this one key: whoever knows it can mint a
 * token for any account and any role. A missing or guessable value is not a
 * warning, it is an open door — so the server refuses to start on one rather
 * than run in a state that only looks secure.
 */
const WEAK_SECRETS = ["change_this_secret", "replace_me_with_a_generated_secret", "secret"];

const checkJwtSecret = () => {
  const secret = process.env.JWT_SECRET || "";

  if (!secret) return "JWT_SECRET is not set";
  if (WEAK_SECRETS.includes(secret)) return "JWT_SECRET is still the placeholder value";
  if (secret.length < 32) return "JWT_SECRET is too short — use at least 32 characters";

  return null;
};

const secretProblem = checkJwtSecret();
if (secretProblem) {
  console.error(`\n❌ Refusing to start: ${secretProblem}.`);
  console.error("   Generate one and put it in backend/.env as JWT_SECRET:");
  console.error(`   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"\n`);
  process.exit(1);
}

const app = express();

/**
 * Only counted once, but it decides what req.ip means — so it goes before any
 * middleware that reads an address, which is both the rate limiters and the
 * request log.
 */
app.set("trust proxy", trustProxy);

app.use(securityHeaders);
app.use(requestLogger);
app.use(cors(corsOptions));


/**
 * Sized to the workspace editor, which saves a whole file as JSON. Express's
 * default is 100 kB — small enough that saving an ordinary source file would
 * fail with an HTML error page rather than anything the editor could show.
 *
 * The ceiling that matters is still the 2 MB one in workspaceFileController,
 * which answers with a clear message; this only has to be a little above it so
 * that check is the one a person actually hits.
 */
app.use(express.json({ limit: "3mb" }));

// Health check
app.get("/", (req, res) => {
  res.json({ message: "AppCric API is running 🚀" });
});

// Routes. There is deliberately no public sign-up or password-reset endpoint —
// every account (client, operations manager, employee) is created and managed by an
// admin from the admin panel.

// Everything under /api is rate limited. The per-route login limiters are
// stricter still and are applied where those routes are declared.
app.use("/api", apiLimiter);

app.use("/api/contact", contactRoutes);
app.use("/api/admin", adminRoutes);
/**
 * HR gets a panel of its own rather than a corner of the admin one.
 *
 * Mounted separately so an HR token is minted, accepted and refused by its own
 * middleware — and so "HR reaches only HR" is a fact about this routing table
 * rather than a permission somebody could widen by mistake. There is no route
 * under here that touches a lead, an invoice, a project or the vault.
 */
app.use("/api/hr", hrRoutes);
/**
 * Sales gets a panel of its own for the same reason HR did: a separate door is
 * a stronger guarantee than a filtered menu. See routes/salesRoutes.js.
 */
/**
 * The one login everybody uses. Mounted before the panels because it belongs
 * to none of them — see controllers/authController.js.
 */
app.use("/api/auth", authRoutes);

app.use("/api/sales", salesRoutes);
/**
 * The delivery panel's API, reachable under both names.
 *
 * The panel is now Operations Manager and its pages live at
 * /operation-manager, so the endpoint answers there too. /api/leader is kept
 * working rather than retired: the same router serves the `manager` role,
 * which is not being renamed, and every call inside the panel already points
 * at it. Moving them all would be two hundred edits for no user-visible gain,
 * and a missed one is a screen that silently 404s.
 */
app.use("/api/operations-manager", leaderRoutes);
app.use("/api/leader", leaderRoutes);
app.use("/api/employee", employeeRoutes);
app.use("/api/client", clientRoutes);

/**
 * Body-parser failures arrive here. Left alone Express answers them with an
 * HTML stack trace, which a fetch() caller can only report as gibberish —
 * every other error in this app is JSON with a message, so these are too.
 */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  // A blocked origin arrives here as a plain Error from the cors callback.
  // Left to the handler below it would be reported as a server fault, which
  // sends whoever hits it looking in the wrong place entirely.
  if (/^Origin .* is not allowed$/.test(err?.message || "")) {
    return res.status(403).json({ message: "This origin is not allowed to call the API" });
  }

  if (err?.type === "entity.too.large") {
    return res.status(413).json({ message: "That request is too large" });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "That request body is not valid JSON" });
  }

  console.error("unhandled error:", err?.message || err);
  return res.status(500).json({ message: "Server error" });
});

/* ------------------------------------------------------ preview listener */

/**
 * Previews get their own port, and therefore their own origin.
 *
 * That is what lets the iframe keep allow-same-origin, which a real app needs:
 * without it the page has an opaque origin and localStorage throws the moment
 * it is touched — so a previewed app cannot log in, or remember anything.
 *
 * Giving it a separate origin rather than the API's means the previewed code
 * gets a localStorage of its own and still cannot read the panel's, whichever
 * way this is eventually deployed.
 */
const previewApp = express();
previewApp.use(cors());

// The slug route sits above the token one so ":token" never swallows "s"
previewApp.get("/preview/s/:slug", servePreviewSlug);
previewApp.get("/preview/s/:slug/*splat", servePreviewSlug);
previewApp.get("/preview/:token", servePreview);
previewApp.get("/preview/:token/*splat", servePreview);

previewApp.get("/", (req, res) =>
  res.status(404).type("text/plain").send("Open a preview from the workspace.")
);

const PREVIEW_PORT = Number(process.env.PREVIEW_PORT) || Number(process.env.PORT || 5000) + 1;

const PORT = process.env.PORT || 5000;

// Express is wrapped in a plain HTTP server so Socket.IO can share the port.
const server = http.createServer(app);

/**
 * Atlas refuses a connection for reasons that outlive a single attempt (a
 * dropped wifi link, a laptop IP that has not been re-whitelisted, a cluster
 * still waking from sleep). Exiting on the first failure turned every one of
 * those into a crashed nodemon that only a manual restart brings back, so the
 * initial connect retries with a widening gap and reports what it is waiting
 * on. Once connected, the driver handles reconnects on its own.
 */
const MONGO_RETRIES = Number(process.env.MONGO_RETRIES || 5);

const connectMongo = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set — add it to backend/.env");
  }

  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_TIMEOUT_MS || 15000),
      });
      return;
    } catch (err) {
      if (attempt >= MONGO_RETRIES) throw err;
      const waitMs = Math.min(30000, 2000 * 2 ** (attempt - 1));
      console.warn(
        `⏳ MongoDB connect failed (attempt ${attempt}/${MONGO_RETRIES}): ${err.message}`
      );
      console.warn(`   retrying in ${Math.round(waitMs / 1000)}s…`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
};

const startServer = async () => {
  try {
    await connectMongo();
    console.log("✅ MongoDB connected");

    /**
     * This database arrived carrying a unique index that capped the panel at
     * exactly one HR account. Dropped here rather than by hand because a
     * restore from an older backup would otherwise bring the ceiling back
     * silently, and nobody would find out until the next hire. Never throws.
     */
    await dropRoleCapIndexes();
    initRealtime(server);
    server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
    previewApp.listen(PREVIEW_PORT, () =>
      console.log(`✅ Workspace previews on port ${PREVIEW_PORT}`)
    );
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    console.error(
      "   Checks: is this machine's IP on the Atlas access list, is the cluster awake,"
    );
    console.error("   and is MONGO_URI in backend/.env correct?");
    process.exit(1);
  }
};

startServer();
