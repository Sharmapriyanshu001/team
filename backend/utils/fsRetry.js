import fs from "fs";
import path from "path";

/**
 * Filesystem operations that survive Windows.
 *
 * Windows releases a file handle a moment after the process is finished with
 * it, and refuses to rename or delete anything still held. Writing a few
 * hundred files and immediately moving the folder they went into is therefore
 * a coin toss: it usually works, and when it does not it fails with EPERM for
 * no reason the caller can see or fix.
 *
 * Everything that renames or removes a directory in this app goes through
 * here, so that knowledge lives in one place instead of being rediscovered
 * each time somebody hits it.
 */

const TRANSIENT = new Set(["EPERM", "EBUSY", "ENOTEMPTY", "EACCES", "EMFILE"]);

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry an operation while the error looks like Windows catching its breath. */
export const withRetry = async (operation, attempts = 6) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (attempt >= attempts || !TRANSIENT.has(err.code)) throw err;
      // Back off a little further each time: 60ms, 120ms, 180ms…
      await settle(attempt * 60);
    }
  }
};

export const rmWithRetry = (target) =>
  withRetry(() => fs.promises.rm(target, { recursive: true, force: true }));

export const renameWithRetry = (from, to) => withRetry(() => fs.promises.rename(from, to));

/**
 * Move a file or folder, falling back to a copy when the rename will not have
 * it. Renaming is the cheap path and works nearly always; copying always
 * works. Correctness first, speed when it is free.
 */
export const moveEntry = async (from, to) => {
  try {
    await renameWithRetry(from, to);
    return "rename";
  } catch (err) {
    if (!TRANSIENT.has(err.code)) throw err;

    const stat = await fs.promises.lstat(from);
    if (stat.isDirectory()) {
      await fs.promises.cp(from, to, { recursive: true, force: true });
    } else {
      await fs.promises.copyFile(from, to);
    }

    // A leftover source is untidy but not a failure — the move itself is done
    await rmWithRetry(from).catch(() => {});
    return "copy";
  }
};

/** Same as moveEntry, kept under its old name for the restore path. */
export const moveDirectory = moveEntry;

/** Every child of `dir`, moved into `into`. Used to unwrap a single root. */
export const moveChildrenUp = async (dir, into) => {
  const children = await fs.promises.readdir(dir);
  for (const child of children) {
    await moveEntry(path.join(dir, child), path.join(into, child));
  }
};
