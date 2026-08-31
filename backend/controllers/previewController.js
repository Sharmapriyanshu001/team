import fs from "fs";
import path from "path";
import http from "http";
import jwt from "jsonwebtoken";

import CodeProject from "../models/CodeProject.js";
import User from "../models/User.js";
import { accessFor, binnedError } from "./codeProjectController.js";
import { resolveInside, workspaceDir } from "../utils/workspaceFs.js";
import { findBySlug, serverPortOf, slugOf } from "../utils/runner.js";

/**
 * Serving a project's own files back to the browser so its output can be seen.
 *
 * The awkward part this solves: an iframe cannot attach an Authorization
 * header, and neither can the CSS, scripts and images that the previewed page
 * goes on to request. So the credential has to travel in the URL — which makes
 * three things non-negotiable:
 *
 *   the token is short-lived, so a URL that leaks stops working
 *   the token names one project, so it can never reach another
 *   every request re-checks the live permissions, not the ones that applied
 *     when the token was minted
 *
 * That last one is what makes unassigning someone take effect immediately
 * rather than in half an hour.
 */

const PREVIEW_TTL_SECONDS = 30 * 60;

// Marks a token as this and only this. A login token must never be usable as a
// preview token, nor the reverse.
const PREVIEW_AUDIENCE = "workspace-preview";

const actorOf = (req) => req.admin || req.leader || req.employee;

/* ------------------------------------------------------------------ mint */

// GET /api/{admin|leader|employee}/workspace/:id/preview-token
export const createPreviewToken = async (req, res) => {
  try {
    const user = actorOf(req);

    const project = await CodeProject.findById(req.params.id);
    if (!project) return res.status(404).json({ message: "Code project not found" });

    const access = accessFor(project, user);
    if (!access) return res.status(404).json({ message: "Code project not found" });

    const binned = binnedError(access);
    if (binned) return res.status(binned.status).json({ message: binned.message });

    if (!access.canRun) {
      return res.status(403).json({ message: "You do not have permission to preview this project" });
    }

    const dir = workspaceDir(project._id);
    if (!dir || !project.workspaceReady || !fs.existsSync(dir)) {
      return res.status(404).json({ message: "This project has no extracted workspace" });
    }

    const token = jwt.sign(
      { p: String(project._id), u: String(user._id) },
      process.env.JWT_SECRET,
      { expiresIn: PREVIEW_TTL_SECONDS, audience: PREVIEW_AUDIENCE }
    );

    /**
     * The full address, built here rather than assembled in the browser: the
     * preview lives on its own port, and only the server knows which one.
     * The hostname is taken from this request so it works whether the panel
     * was reached over localhost or a machine name on the network.
     */
    const previewPort = Number(process.env.PREVIEW_PORT) || Number(process.env.PORT || 5000) + 1;
    const host = (req.hostname || "localhost").replace(/:\d+$/, "");

    return res.status(200).json({
      token,
      path: `/preview/${token}/`,
      url: `${req.protocol}://${host}:${previewPort}/preview/${token}/`,
      expiresIn: PREVIEW_TTL_SECONDS,
      entryFile: project.entryFile || "",
      // A Vite or React project needs its dev server; raw files will not run
      /**
       * Can the files be shown as they are, with nothing running?
       *
       * Only a static site can. Having an index.html is not the same thing —
       * a Vite project has one too, and it asks the browser for JSX, so
       * serving it raw gives a blank panel. Saying "servable" there hid the
       * very notice that explains what to do about it.
       */
      servable: project.stack === "static",
      // Whether a dev server is answering right now is a separate question,
      // and the one the panel should lead with
      devServerUp: Boolean(serverPortOf(project._id)),
      stack: project.stack,
    });
  } catch (err) {
    console.error("createPreviewToken error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------------ serve */

/**
 * Stacks whose pages exist only once a dev server or a build has made them.
 * Their index.html points at source the browser cannot execute, so the files on
 * disk are not a preview of anything.
 */
const BUILD_STEP_STACKS = new Set(["vite", "react", "next"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/* --------------------------------------------------------------- proxying */

/**
 * Hand the request to the project's own dev server and pipe the answer back.
 *
 * Written by hand rather than with a proxy library because the requirements
 * are narrow and the library would be one more dependency between an admin
 * and their own files: one upstream, always loopback, always a port this app
 * handed out itself.
 *
 * The path is passed through untouched. Vite serves "/src/main.jsx",
 * "/@vite/client" and its HMR endpoints from the root, so rewriting anything
 * here would break the very thing the proxy exists for.
 */
const proxyToDevServer = (req, res, port, deny, upstreamPath) => {
  const query = req.originalUrl.includes("?")
    ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
    : "";

  /**
   * Which path the dev server is asked for.
   *
   * A server told to serve under a base expects that base in the URL — asking
   * it for "/" instead makes it redirect to its base, which the browser
   * follows straight back here, and round it goes. So a slug request is
   * forwarded exactly as it arrived, while a server with no base is asked for
   * the path with the preview prefix taken off.
   */
  // Named "target" rather than "path": this module imports node:path, and
  // shadowing it inside a function is a trap for whoever edits next.
  let target;
  if (upstreamPath) {
    target = upstreamPath;
  } else {
    const splat = req.params.splat ?? req.params[0] ?? "";
    const rest = Array.isArray(splat) ? splat.join("/") : String(splat);
    target = `/${rest}`;
  }

  const upstream = http.request(
    {
      host: "127.0.0.1",
      port,
      method: req.method,
      path: `${target}${query}`,
      /**
       * A fresh socket per request rather than the shared pool. Traffic here
       * is a handful of requests per page, and pooled keep-alive sockets were
       * occasionally left half-open between them — which surfaced as a request
       * that simply never answered and timed out.
       */
      agent: false,
      headers: {
        // Only what a dev server needs. The preview token is deliberately not
        // forwarded: the project's own code has no business seeing it.
        accept: req.headers.accept || "*/*",
        "accept-encoding": "identity",
        "user-agent": req.headers["user-agent"] || "workspace-preview",
        host: `127.0.0.1:${port}`,
      },
    },
    (answer) => {
      res.status(answer.statusCode || 502);

      Object.entries(answer.headers).forEach(([key, value]) => {
        // Hop-by-hop headers are ours to decide, not the upstream's
        if (["connection", "keep-alive", "transfer-encoding"].includes(key)) return;
        res.setHeader(key, value);
      });

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");

      answer.pipe(res);
    }
  );

  upstream.setTimeout(30_000, () => {
    upstream.destroy();
    if (!res.headersSent) {
      deny(504, "Dev server not answering", "It may still be starting up. Try again in a moment.");
    }
  });

  upstream.on("error", (err) => {
    if (res.headersSent) return res.end();
    deny(
      502,
      "Dev server unreachable",
      `The project's server on port ${port} did not answer (${err.code || err.message}).`
    );
  });

  /**
   * A GET has no body, so it is ended outright rather than piped. Waiting on a
   * stream that will never produce anything is how this turned into
   * intermittent 502s — the upstream sat holding a request that was, as far as
   * it could tell, still being sent.
   *
   * Anything that does carry a body is piped, which works because this route
   * is mounted above the JSON body parser and the stream is still untouched.
   */
  if (["GET", "HEAD", "DELETE", "OPTIONS"].includes(req.method)) {
    upstream.end();
  } else {
    req.pipe(upstream);
  }
};

const problemPage = (status, title, detail) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font:14px/1.6 system-ui,sans-serif;background:#0B0F1A;color:#94a3b8;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
  div{max-width:26rem;padding:2rem}
  h1{font-size:15px;color:#e2e8f0;margin:0 0 .5rem}
  code{color:#60a5fa}
</style></head>
<body><div><h1>${title}</h1><p>${detail}</p></div></body></html>`;

/**
 * GET /preview/:token/*
 *
 * Mounted outside the authenticated routers on purpose — the browser cannot
 * add a header here. The token is the whole credential, so this handler is
 * written to assume it is being attacked.
 */
export const servePreview = async (req, res) => {
  const deny = (status, title, detail) => {
    res.status(status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.send(problemPage(status, title, detail));
  };

  try {
    let claims;
    try {
      claims = jwt.verify(req.params.token, process.env.JWT_SECRET, {
        audience: PREVIEW_AUDIENCE,
      });
    } catch (err) {
      const expired = err.name === "TokenExpiredError";
      return deny(
        401,
        expired ? "Preview expired" : "Preview link not valid",
        expired
          ? "Reopen the preview from the workspace to get a fresh link."
          : "This link cannot be used to view a project."
      );
    }

    /**
     * Re-check from scratch on every request. The token says who claimed to be
     * asking; whether they may still see this project is a question only the
     * database can answer, and the answer may have changed since it was issued.
     */
    const [project, user] = await Promise.all([
      CodeProject.findById(claims.p),
      User.findById(claims.u).select("role status name"),
    ]);

    if (!project) return deny(404, "Project gone", "This project no longer exists.");
    if (!user || user.status !== "active") {
      return deny(403, "Access withdrawn", "This account can no longer view previews.");
    }

    const access = accessFor(project, user);
    if (!access) {
      return deny(403, "Access withdrawn", "This project is no longer assigned to you.");
    }
    /**
     * Re-checked on every request, so a preview open in somebody's browser
     * stops serving the moment the admin deletes the project — rather than
     * carrying on until they happen to reload.
     */
    if (binnedError(access)) {
      return deny(404, "Project deleted", "This project was deleted by an admin.");
    }
    if (!access.canRun) {
      return deny(403, "Preview turned off", "Preview permission for this project was removed.");
    }

    const root = workspaceDir(project._id);
    if (!root || !fs.existsSync(root)) {
      return deny(404, "Nothing to preview", "This project has no extracted workspace.");
    }

    /* ---------------------------------------------------- a running dev server */

    /**
     * When the project has a dev server up, everything goes to it instead of
     * to the files on disk.
     *
     * This is what makes a React or Vite project previewable at all. Its
     * index.html asks for "/src/main.jsx", which is JSX the browser cannot
     * execute — serving the raw file gives a blank page no matter how correct
     * the file server is. Only the dev server can answer that request.
     */
    const devPort = serverPortOf(project._id);

    /**
     * A dev server told to serve under /preview/s/<slug>/ emits that prefix on
     * every URL it generates, so the browser is sent there once and everything
     * afterwards — modules, HMR, the favicon — lands back inside the preview.
     *
     * Proxying the page from under the token instead would work for the HTML
     * and fail for all of it: the page asks for "/src/main.jsx", the browser
     * resolves that against the origin root, and the request never reaches
     * this handler at all.
     */
    const slug = slugOf(project._id);
    if (devPort && slug) {
      const splat = req.params.splat ?? req.params[0] ?? "";
      const rest = Array.isArray(splat) ? splat.join("/") : String(splat);
      return res.redirect(302, `/preview/s/${slug}/${rest}`);
    }

    // A server with no base prefix — anything that is not Vite — is proxied
    // as before. Pages that use relative URLs work; absolute ones will not.
    if (devPort) return proxyToDevServer(req, res, devPort, deny);

    /* ------------------------------------- nothing running, and nothing to show */

    /**
     * With no dev server, a build-step project has nothing that can be served
     * from disk. Its index.html asks for "/src/main.jsx" — raw JSX — and for
     * assets at paths only the bundler knows how to answer, so handing the
     * browser that file produces a blank panel and a column of 404s. That
     * reads as the preview being broken when the real answer is that the
     * server was never started.
     *
     * Only the stacks that compile their pages are held back. A static site is
     * the files on disk, and a plain node project may well have an HTML file
     * worth opening — neither needs a bundler standing between the two.
     */
    if (BUILD_STEP_STACKS.has(project.stack)) {
      return deny(
        503,
        "No dev server running yet",
        `This is a ${project.stack} project, so its pages are built as they are served — ` +
          `there is nothing on disk a browser can open on its own.` +
          `<br><br>Open the terminal and start it:` +
          `<br><code>cd ${project.rootDir || "."}</code>` +
          `<br><code>npm install</code>` +
          `<br><code>npm run dev</code>` +
          `<br><br>The preview will pick it up on its own once it is up.`
      );
    }

    /* ------------------------------------------------------ resolve the file */

    /**
     * Express 5 hands the wildcard back already percent-decoded, as an array
     * of segments. Decoding it again here would turn "%252e%252e" into ".."
     * after the jail had already approved it — so it is joined as given and
     * nothing re-decodes it.
     */
    const splat = req.params.splat ?? req.params[0] ?? "";
    const requested = Array.isArray(splat) ? splat.join("/") : String(splat);

    // A directory request means its index page
    const wantsIndex = !requested || requested.endsWith("/");
    const relative = wantsIndex
      ? path.posix.join(requested, project.entryFile || "index.html")
      : requested;

    const target = resolveInside(root, relative);
    if (!target) return deny(403, "Outside the project", "That path is not part of this project.");

    let stat;
    try {
      stat = await fs.promises.lstat(target);
    } catch {
      return deny(404, "Not found", `<code>${relative}</code> is not in this project.`);
    }

    // A symlink inside the workspace could point anywhere on the host
    if (stat.isSymbolicLink()) {
      return deny(403, "Not served", "Links are not served from a preview.");
    }
    if (stat.isDirectory()) {
      return deny(404, "No index page", `<code>${relative}</code> is a folder.`);
    }

    /* --------------------------------------------------------------- headers */

    const ext = path.extname(target).toLowerCase();

    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    // Never let the browser guess a type we did not declare
    res.setHeader("X-Content-Type-Options", "nosniff");
    // The whole point is to see the file as it is right now
    res.setHeader("Cache-Control", "no-store");
    // A preview is somebody's private project — never a search result
    res.setHeader("X-Robots-Tag", "noindex, nofollow");

    const stream = fs.createReadStream(target);
    stream.on("error", (err) => {
      console.error("servePreview stream error:", err.message);
      if (!res.headersSent) res.status(500).end();
    });
    return stream.pipe(res);
  } catch (err) {
    console.error("servePreview error:", err);
    return deny(500, "Preview failed", "Something went wrong serving this file.");
  }
};

/* --------------------------------------------------------- slug preview */

/**
 * GET /preview/s/:slug/*
 *
 * Where a running dev server is actually served from. The slug is the
 * credential — a random value the previewed page carries in its own URLs,
 * handed out only to a browser that already passed the token check to load
 * that page, and gone the moment the process stops.
 *
 * It has to work this way round: the alternative is putting the token in the
 * path, and a page that asks for "/src/main.jsx" would never reach it.
 */
export const servePreviewSlug = (req, res) => {
  const deny = (status, title, detail) => {
    res.status(status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.send(problemPage(status, title, detail));
  };

  const found = findBySlug(req.params.slug);
  if (!found) {
    return deny(
      404,
      "Nothing running here",
      "The dev server for this preview has stopped. Start it again from the workspace terminal."
    );
  }

  /**
   * Forwarded with the /preview/s/<slug>/ prefix intact: that is the base the
   * dev server was started with, and it answers on it.
   */
  const pathOnly = req.originalUrl.split("?")[0];
  return proxyToDevServer(req, res, found.port, deny, pathOnly);
};
