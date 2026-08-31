import fs from "fs";
import path from "path";
import yauzl from "yauzl";
import yazl from "yazl";

import { moveChildrenUp, rmWithRetry } from "./fsRetry.js";

/**
 * Secure ZIP extraction.
 *
 * A ZIP is untrusted input: the names inside it are attacker-controlled even
 * when the uploader is trusted, because the uploader rarely built the archive
 * themselves. Everything here exists to make sure that a malicious or merely
 * broken archive cannot write a single byte outside the folder it was given,
 * and cannot exhaust the disk on the way.
 *
 * Entries are streamed one at a time (lazyEntries) so a 50 MB archive never
 * becomes 50 MB of resident memory.
 */

/* ------------------------------------------------------------------ limits */

// Generous for a real project, far below anything that could fill a disk.
export const EXTRACT_LIMITS = {
  maxEntries: 20000,
  maxTotalBytes: 300 * 1024 * 1024, // uncompressed, across the whole archive
  maxFileBytes: 25 * 1024 * 1024, // any single file
  maxDepth: 40,
};

// Never worth extracting: editor/OS litter, and folders that are rebuilt from
// package.json anyway. Skipping node_modules alone often turns a 200 MB
// archive into a 2 MB one.
const SKIP_SEGMENTS = new Set(["node_modules", ".git", "__MACOSX", ".next", "dist", "build"]);
const SKIP_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/* -------------------------------------------------------------- path safety */

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** True when the ZIP entry is a symlink, which we never write. */
const isSymlink = (entry) => {
  // Unix mode lives in the high 16 bits of the external attributes, and is
  // only meaningful when the archive was made on a unix-like system.
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return mode !== 0 && (mode & S_IFMT) === S_IFLNK;
};

/**
 * The jail. Returns the absolute path an entry may be written to, or null if
 * the name tries to leave the destination by any route:
 *
 *   ../../etc/passwd      relative escape
 *   /etc/passwd           absolute
 *   C:\Windows\x          drive-qualified
 *   \\server\share\x      UNC
 *   a/../../../b          escape after normalisation
 */
export const safeTarget = (root, rawName) => {
  if (!rawName) return null;

  // A conforming ZIP uses forward slashes; a broken one may use backslashes,
  // and on Windows those are separators too. Treat both as separators so the
  // checks below cannot be side-stepped by choosing the other one.
  const cleaned = rawName.replace(/\\/g, "/").replace(/^\/+/, (m) => (m ? "/" : ""));

  if (cleaned.startsWith("/")) return null; // absolute
  if (/^[a-zA-Z]:/.test(cleaned)) return null; // drive letter
  if (cleaned.includes("\0")) return null; // null byte

  const parts = cleaned.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.includes("..")) return null;
  if (parts.length > EXTRACT_LIMITS.maxDepth) return null;

  const target = path.resolve(root, parts.join(path.sep));

  // Belt and braces: even after the checks above, confirm where we landed.
  const fence = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(fence)) return null;

  return target;
};

/** Entries we drop on the floor rather than write. */
const shouldSkip = (rawName) => {
  const parts = rawName.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((part) => SKIP_SEGMENTS.has(part))) return true;
  return SKIP_NAMES.has(parts[parts.length - 1]);
};

/* ---------------------------------------------------------------- extraction */

const openZip = (zipPath) =>
  new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) =>
      err ? reject(err) : resolve(zip)
    );
  });

/**
 * yauzl validates entry names itself and aborts the whole archive on an
 * absolute path or a `..` segment, rather than handing us the entry to skip.
 *
 * That is the stricter posture and worth keeping: an archive carrying a
 * traversal payload is hostile or corrupt, and half-extracting one is worse
 * than refusing it. safeTarget() below stays as the second gate for the names
 * yauzl does allow. All this does is turn the library's wording into
 * something an admin can act on.
 */
const describeZipError = (err) => {
  const raw = err?.message || "";

  if (/invalid relative path|absolute path/i.test(raw)) {
    return `This archive contains an unsafe file path (${raw.split(": ").pop()}) and was rejected in full`;
  }
  if (/invalid characters in fileName/i.test(raw)) {
    return "This archive contains a file name with illegal characters and was rejected in full";
  }
  if (/end of central directory|not a zip|signature/i.test(raw)) {
    return "That file is not a readable ZIP archive";
  }
  return raw || "Could not read that archive";
};

const openEntryStream = (zip, entry) =>
  new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)));
  });

/**
 * Write one entry, refusing to exceed its byte budget mid-stream. A ZIP header
 * can lie about uncompressed size, so the running total is what is enforced —
 * not the number the archive claims.
 */
const writeEntry = (stream, target, budget) =>
  new Promise((resolve, reject) => {
    let written = 0;
    let failed = false;
    const out = fs.createWriteStream(target);

    /**
     * Stop mid-stream and leave nothing behind. The partial file can only be
     * removed once the handle is actually closed — on Windows an open handle
     * makes the unlink fail silently — so the cleanup waits for "close".
     */
    const fail = (message) => {
      if (failed) return;
      failed = true;

      stream.destroy();
      out.once("close", () => {
        fs.promises
          .rm(target, { force: true })
          .catch(() => {})
          .finally(() => reject(new Error(message)));
      });
      out.destroy();
    };

    stream.on("data", (chunk) => {
      written += chunk.length;
      if (written > budget.maxFileBytes) return fail("A file inside the archive is too large");
      if (budget.used + written > budget.maxTotalBytes) {
        return fail("The archive expands to more than the allowed size");
      }
    });

    stream.on("error", (err) => !failed && reject(err));
    out.on("error", (err) => !failed && reject(err));
    out.on("finish", () => !failed && resolve(written));

    stream.pipe(out);
  });

/**
 * Extract `zipPath` into `destDir`.
 *
 * The destination must already exist and should be empty — it is created per
 * project id by the caller, so two projects can never share one.
 *
 * Returns what was written and, importantly, what was refused: a caller that
 * silently drops entries is indistinguishable from one that extracted them.
 */
export const extractZip = async (zipPath, destDir, limits = {}) => {
  const budget = { ...EXTRACT_LIMITS, ...limits, used: 0 };

  /**
   * Lifting a single wrapper folder is right for an archive a person built,
   * and wrong for one this app wrote: a snapshot's top level is already the
   * project root, so stripping it would move the project into its own
   * subfolder on every restore. Restores pass strip: false.
   */
  const strip = limits.strip !== false;

  await fs.promises.mkdir(destDir, { recursive: true });

  let zip;
  try {
    zip = await openZip(zipPath);
  } catch (err) {
    throw new Error(describeZipError(err));
  }

  const result = { files: 0, directories: 0, bytes: 0, skipped: [], rejected: [] };

  const note = (list, name, reason) => {
    // Keep the report bounded — a hostile archive could have 20k bad names
    if (list.length < 50) list.push({ name, reason });
  };

  await new Promise((resolve, reject) => {
    let entriesSeen = 0;

    // An unsafe name aborts the archive here, before any of it is trusted
    zip.on("error", (err) => reject(new Error(describeZipError(err))));
    zip.on("end", resolve);

    zip.on("entry", async (entry) => {
      try {
        entriesSeen += 1;
        if (entriesSeen > budget.maxEntries) {
          throw new Error(`The archive holds more than ${budget.maxEntries} entries`);
        }

        const raw = entry.fileName;

        if (isSymlink(entry)) {
          note(result.rejected, raw, "symlink");
          return zip.readEntry();
        }
        if (shouldSkip(raw)) {
          note(result.skipped, raw, "ignored folder or file");
          return zip.readEntry();
        }

        const target = safeTarget(destDir, raw);
        if (!target) {
          note(result.rejected, raw, "path escapes the project folder");
          return zip.readEntry();
        }

        // A trailing slash is how a ZIP marks a directory
        if (/[/\\]$/.test(raw)) {
          await fs.promises.mkdir(target, { recursive: true });
          result.directories += 1;
          return zip.readEntry();
        }

        await fs.promises.mkdir(path.dirname(target), { recursive: true });

        const stream = await openEntryStream(zip, entry);
        const written = await writeEntry(stream, target, budget);

        budget.used += written;
        result.bytes += written;
        result.files += 1;

        return zip.readEntry();
      } catch (err) {
        zip.close();
        return reject(err);
      }
    });

    zip.readEntry();
  });

  if (strip) await stripSingleRoot(destDir);

  return result;
};

/* --------------------------------------------------------------- snapshots */

// Folders that are rebuilt rather than kept — the same ones extraction skips,
// so a snapshot of a restored project is the same shape as the original.
const SNAPSHOT_SKIP = new Set(["node_modules", ".git", ".next", "__MACOSX"]);

/** Every file under `dir`, as paths relative to it, using forward slashes. */
const walkFiles = async (dir, base = dir, out = [], depth = 0) => {
  if (depth > EXTRACT_LIMITS.maxDepth) return out;

  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    // A symlink is never followed here for the same reason it is never
    // written: it could point anywhere.
    if (entry.isSymbolicLink()) continue;

    const absolute = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SNAPSHOT_SKIP.has(entry.name)) continue;
      await walkFiles(absolute, base, out, depth + 1);
    } else if (entry.isFile()) {
      out.push({
        absolute,
        relative: path.relative(base, absolute).split(path.sep).join("/"),
      });
    }
  }

  return out;
};

/**
 * Zip a whole workspace into `zipPath`. This is how a version snapshot is
 * taken: the same shape as the archive that was uploaded, so restoring one is
 * the same operation as extracting the other.
 */
export const zipDirectory = async (sourceDir, zipPath) => {
  const files = await walkFiles(sourceDir);

  if (!files.length) {
    throw new Error("There is nothing in this project to snapshot");
  }
  if (files.length > EXTRACT_LIMITS.maxEntries) {
    throw new Error("This project has too many files to snapshot");
  }

  const zip = new yazl.ZipFile();
  for (const file of files) zip.addFile(file.absolute, file.relative);
  zip.end();

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    zip.outputStream.on("error", reject);
    out.on("error", reject);
    out.on("close", resolve);
    zip.outputStream.pipe(out);
  });

  const { size } = await fs.promises.stat(zipPath);
  return { files: files.length, size };
};

/**
 * Folder names that are part of a project rather than a wrapper around one.
 * A ZIP whose only top-level entry is "src" is a project that starts at src —
 * lifting its contents up would destroy the structure, not fix it.
 */
const PROJECT_OWN_DIRS = new Set([
  "src",
  "app",
  "lib",
  "public",
  "static",
  "assets",
  "components",
  "pages",
  "styles",
  "scripts",
  "images",
  "img",
  "css",
  "js",
  "test",
  "tests",
  "docs",
]);

/**
 * Most archives wrap everything in one folder ("ecommerce/src/...").
 * Lifting that folder's contents up one level is what turns the archive into a
 * project root, so package.json sits where the workspace expects it.
 *
 * Only a wrapper is lifted. If the single folder is one the project owns, the
 * archive is left exactly as it came.
 */
const stripSingleRoot = async (destDir) => {
  const entries = await fs.promises.readdir(destDir, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) return false;

  const rootName = entries[0].name;
  if (PROJECT_OWN_DIRS.has(rootName.toLowerCase())) return false;

  const inner = path.join(destDir, rootName);

  /**
   * Every name that survived safeTarget is a plain segment, so these joins are
   * as safe as the extraction that produced them.
   *
   * The move goes through moveChildrenUp rather than a plain rename because
   * this runs immediately after writing the files, and Windows refuses to
   * rename a folder whose handles it has not released yet. That failure was
   * intermittent, which is the worst kind: an upload that worked yesterday
   * would fail today with EPERM and no way for anyone to tell why.
   */
  await moveChildrenUp(inner, destDir);
  await rmWithRetry(inner);

  return true;
};
