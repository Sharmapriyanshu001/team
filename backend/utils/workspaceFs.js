import fs from "fs";
import path from "path";

import { UPLOAD_DIR } from "./uploads.js";
import { rmWithRetry } from "./fsRetry.js";

/**
 * Every filesystem touch a workspace makes goes through this module.
 *
 * The rule it enforces is single and absolute: a request may only reach paths
 * underneath its own project's folder. Project folders are named by their
 * database id, so isolation between two projects is the same check as
 * isolation from the rest of the disk — there is no second code path where a
 * project id could be swapped for a relative climb.
 */

export const WORKSPACE_ROOT = path.resolve(UPLOAD_DIR, "workspaces");

if (!fs.existsSync(WORKSPACE_ROOT)) {
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
}

/** Absolute folder for one project. The id is validated, never interpolated raw. */
export const workspaceDir = (projectId) => {
  const id = String(projectId || "");
  // Mongo ObjectIds only — this is what stops "../../" ever reaching a join
  if (!/^[a-f0-9]{24}$/i.test(id)) return null;
  return path.join(WORKSPACE_ROOT, id);
};

/**
 * Resolve a client-supplied relative path inside a project, or null if it
 * tries to leave. Same fence as the ZIP extractor, for the same reason: the
 * path came from outside.
 */
export const resolveInside = (root, relPath = "") => {
  if (!root) return null;

  const cleaned = String(relPath).replace(/\\/g, "/");
  if (cleaned.includes("\0")) return null;
  if (cleaned.startsWith("/")) return null;
  if (/^[a-zA-Z]:/.test(cleaned)) return null;

  const parts = cleaned.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.includes("..")) return null;

  const target = path.resolve(root, parts.join(path.sep));

  const fence = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(fence)) return null;

  return target;
};

/** The path as the browser should see it: forward slashes, relative to root. */
export const relativeTo = (root, absolute) =>
  path.relative(root, absolute).split(path.sep).join("/");

/* -------------------------------------------------------------------- tree */

const TREE_LIMITS = { maxEntries: 8000, maxDepth: 20 };

// Folders that exist but are never worth walking into for a file tree.
const HIDDEN_DIRS = new Set(["node_modules", ".git", ".next", "__MACOSX"]);

/**
 * Walk the project into a nested tree. Directories sort above files and both
 * sort by name, so the explorer renders in a stable, familiar order.
 *
 * Capped on both count and depth: an explorer that hangs on a pathological
 * project is worse than one that says "this folder is very large".
 */
export const buildTree = async (root) => {
  const state = { count: 0, truncated: false };

  const walk = async (dir, depth) => {
    if (depth > TREE_LIMITS.maxDepth) {
      state.truncated = true;
      return [];
    }

    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const nodes = [];

    for (const entry of entries) {
      if (state.count >= TREE_LIMITS.maxEntries) {
        state.truncated = true;
        break;
      }

      // A symlink inside the workspace could point anywhere; the extractor
      // refuses to create them, and the tree refuses to follow one that
      // arrived by any other route.
      if (entry.isSymbolicLink()) continue;

      const absolute = path.join(dir, entry.name);
      state.count += 1;

      if (entry.isDirectory()) {
        if (HIDDEN_DIRS.has(entry.name)) {
          nodes.push({
            name: entry.name,
            path: relativeTo(root, absolute),
            type: "folder",
            children: [],
            collapsed: true,
          });
          continue;
        }
        nodes.push({
          name: entry.name,
          path: relativeTo(root, absolute),
          type: "folder",
          children: await walk(absolute, depth + 1),
        });
      } else if (entry.isFile()) {
        let size = 0;
        try {
          size = (await fs.promises.stat(absolute)).size;
        } catch {
          size = 0;
        }
        nodes.push({
          name: entry.name,
          path: relativeTo(root, absolute),
          type: "file",
          size,
        });
      }
    }

    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return nodes;
  };

  const tree = await walk(root, 0);
  return { tree, count: state.count, truncated: state.truncated };
};

/** Flat totals for the project card, without building the whole tree. */
export const measure = async (root) => {
  let files = 0;
  let bytes = 0;

  const walk = async (dir, depth) => {
    if (depth > TREE_LIMITS.maxDepth || files > TREE_LIMITS.maxEntries) return;

    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (HIDDEN_DIRS.has(entry.name)) continue;
        await walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        files += 1;
        try {
          bytes += (await fs.promises.stat(absolute)).size;
        } catch {
          /* a file that vanished mid-walk simply does not count */
        }
      }
    }
  };

  await walk(root, 0);
  return { files, bytes };
};

/* ---------------------------------------------------------- stack detection */

export const STACKS = ["static", "node", "react", "vite", "next", "unknown"];

const readJson = async (file) => {
  try {
    return JSON.parse(await fs.promises.readFile(file, "utf8"));
  } catch {
    return null;
  }
};

const exists = async (file) => {
  try {
    await fs.promises.access(file);
    return true;
  } catch {
    return false;
  }
};

/** Read one folder's markers and say what kind of project sits there. */
const inspectFolder = async (root, prefix = "") => {
  const at = (name) => path.join(root, name);
  const rel = (name) => (prefix ? `${prefix}/${name}` : name);

  const pkg = await readJson(at("package.json"));

  if (!pkg) {
    // No package.json: an HTML file makes it a static site
    if (await exists(at("index.html"))) {
      return { stack: "static", entryFile: rel("index.html"), scripts: {}, packageName: "" };
    }
    if (await exists(at("public/index.html"))) {
      return { stack: "static", entryFile: rel("public/index.html"), scripts: {}, packageName: "" };
    }
    return null;
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  let stack = "node";
  if (deps.next) stack = "next";
  else if (
    deps.vite ||
    (await exists(at("vite.config.js"))) ||
    (await exists(at("vite.config.ts")))
  ) {
    stack = "vite";
  } else if (deps.react) stack = "react";

  return {
    stack,
    entryFile: (await exists(at("index.html"))) ? rel("index.html") : null,
    scripts: pkg.scripts || {},
    packageName: pkg.name || "",
  };
};

/**
 * What kind of project this is, which decides how it can be previewed:
 * "static" runs in an iframe today, everything else needs a real process.
 *
 * If the root holds no markers, one level down is checked too — a repository
 * with backend/ and frontend/ beside each other is an ordinary shape, and
 * calling it "unknown" would be a shrug rather than an answer. The folder the
 * answer came from is reported, because whatever runs this project later needs
 * to know where to run it.
 */
export const detectStack = async (root) => {
  const atRoot = await inspectFolder(root);
  if (atRoot) return { ...atRoot, rootDir: "" };

  let children;
  try {
    children = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    children = [];
  }

  // Front-end folders first: they are what a preview would want to show
  const order = ["frontend", "client", "web", "app", "ui", "src", "packages"];
  const folders = children
    .filter((entry) => entry.isDirectory() && !HIDDEN_DIRS.has(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const rank = (name) => {
        const at = order.indexOf(name.toLowerCase());
        return at === -1 ? order.length : at;
      };
      return rank(a) - rank(b) || a.localeCompare(b);
    });

  for (const folder of folders.slice(0, 12)) {
    const found = await inspectFolder(path.join(root, folder), folder);
    if (found) return { ...found, rootDir: folder };
  }

  return { stack: "unknown", entryFile: null, scripts: {}, packageName: "", rootDir: "" };
};

/* -------------------------------------------------------------- housekeeping */

// Windows-safe move and remove live in one place — see utils/fsRetry.js
export { moveDirectory, rmWithRetry } from "./fsRetry.js";

/** Remove a project's whole workspace. Never throws on a missing folder. */
export const removeWorkspace = async (projectId) => {
  const dir = workspaceDir(projectId);
  if (!dir) return;

  try {
    await rmWithRetry(dir);
  } catch (err) {
    console.error("removeWorkspace error:", err.message);
  }
};
