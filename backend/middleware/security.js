import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * The things that have to be true before this server faces a network it does
 * not control: who may call it, how often, and what is written down when they
 * do.
 *
 * Kept together in one file rather than sprinkled through server.js because
 * each of them is a decision with a reason, and the reasons only make sense
 * beside each other.
 */

const isProduction = process.env.NODE_ENV === "production";

/* ------------------------------------------------------------------ origins */

/**
 * Which sites may call this API from a browser.
 *
 * `cors()` with no arguments answers every origin with permission. For an API
 * whose whole authority is a bearer token that is less bad than it sounds — a
 * token still has to be sent — but it also means any page on the internet can
 * script requests against this server with a token it has phished or found in
 * a shared machine's localStorage. An allow list costs one env var.
 *
 * Development gets the Vite dev server for free, because refusing to run on a
 * laptop until somebody writes a config file only teaches people to disable
 * the check.
 */
const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

const readOrigins = () => {
  const configured = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);

  if (configured.length) return configured;

  if (isProduction) {
    console.error("\n❌ Refusing to start: CORS_ORIGINS is not set.");
    console.error("   In production every browser origin that may call this API must be named.");
    console.error("   Put them in backend/.env, comma separated:");
    console.error("   CORS_ORIGINS=https://panel.example.com,https://www.example.com\n");
    process.exit(1);
  }

  console.warn("⚠️  CORS_ORIGINS not set — allowing local dev origins only.");
  return DEV_ORIGINS;
};

export const allowedOrigins = readOrigins();

/**
 * A request with no Origin header is not a browser doing a cross-site call —
 * it is curl, a health check, a mobile app, or the API being hit server side.
 * CORS has nothing to say about those, so they pass; the bearer token is what
 * actually guards them.
 */
export const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ""))) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} is not allowed`));
  },
  credentials: true,
};

/* -------------------------------------------------------------- rate limits */

/**
 * Behind nginx every request arrives from 127.0.0.1, so without this one
 * visitor's limit would be shared by the entire internet. Set TRUST_PROXY to
 * the number of proxies in front of this server — 1 for a single nginx.
 *
 * Deliberately not `true`: trusting every hop lets a caller forge
 * X-Forwarded-For and hand themselves a fresh limit per request.
 */
export const trustProxy = (() => {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === "") return false;
  const hops = Number(raw);
  return Number.isFinite(hops) ? hops : raw;
})();

const limitMessage = (message) => ({
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message },
});

/**
 * The login limiter, keyed on the pair (address, email).
 *
 * Keyed on the pair rather than on either alone because both single-key
 * versions are wrong in a way that matters here: by address alone, one office
 * shares one allowance and the fifth person to sign in after lunch is locked
 * out; by email alone, anybody who knows a colleague's address can lock them
 * out on purpose.
 *
 * Successful sign-ins are not counted, so somebody who simply mistyped once
 * and then got it right still has their full allowance tomorrow. What the
 * counter measures is failures, which is the only thing being throttled.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  /**
   * ipKeyGenerator rather than req.ip: an IPv6 user is routinely handed a
   * whole /64, so keying on the exact address would let them walk to a fresh
   * one for every guess and never meet the limit at all. The helper collapses
   * the address to its subnet, which is the unit that actually costs money to
   * change.
   */
  keyGenerator: (req) => {
    const email = String(req.body?.email || "").toLowerCase().trim();
    return `${ipKeyGenerator(req.ip)}|${email}`;
  },
  ...limitMessage("Too many failed sign-in attempts. Try again in 15 minutes."),
});

/**
 * A second, looser limit on the same routes, keyed on address alone.
 *
 * The pair limiter above stops somebody guessing one person's password. It
 * does nothing about somebody spraying one common password across a thousand
 * addresses, because every attempt is a different pair. This catches that.
 * Set well above what a real office produces — signing in is a rare act.
 */
export const loginBurstLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  skipSuccessfulRequests: true,
  ...limitMessage("Too many sign-in attempts from this network. Try again shortly."),
});

/**
 * The blanket limit. High enough that a dashboard opening a dozen panels at
 * once never notices it, low enough that a script scraping every record does.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  ...limitMessage("Too many requests. Slow down and try again in a minute."),
});

/* ------------------------------------------------------------------ headers */

/**
 * Helmet, minus the Content-Security-Policy.
 *
 * CSP governs what a *page* may load. This server returns JSON and file
 * downloads, so a policy here protects nothing while being one more thing to
 * get wrong. The panel's own CSP belongs on whatever serves the built
 * frontend — nginx — where it can actually see the page.
 *
 * The resource policy is relaxed to cross-origin on purpose: the panel and the
 * API are different origins in every real deployment, and the strict default
 * would block the panel from displaying an uploaded document.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
});

/* ------------------------------------------------------------------ logging */

/**
 * One line per request. Without it a production incident is reconstructed from
 * guesses — this is the difference between "the panel was slow yesterday" and
 * knowing which endpoint answered in nine seconds.
 *
 * The health check is skipped because an uptime monitor hitting "/" every
 * thirty seconds would otherwise be most of the log.
 */
export const requestLogger = morgan(isProduction ? "combined" : "dev", {
  skip: (req) => req.originalUrl === "/",
});
