import crypto from "crypto";

/**
 * The video link a meeting is held on.
 *
 * This is a placeholder, and deliberately an obvious one. A real Google Meet
 * link is not something an app invents — Calendar's API creates it against a
 * Google Workspace account, and until this app has credentials to talk to one
 * there is nothing to ask. Generating a well-formed code locally means every
 * screen, notification and click-through is already built against the shape of
 * the real thing, so switching over is this one function and nothing else.
 *
 * Codes follow Meet's own format, three-four-three lowercase letters, because
 * a link that looks wrong invites somebody to "fix" it by hand.
 */

const LETTERS = "abcdefghijkmnopqrstuvwxyz"; // no l — it reads as 1 in a link

const block = (length) =>
  Array.from(crypto.randomBytes(length))
    .map((byte) => LETTERS[byte % LETTERS.length])
    .join("");

/** A fresh meeting code, e.g. "kqf-mzbn-rtd". */
export const newMeetCode = () => `${block(3)}-${block(4)}-${block(3)}`;

/**
 * A link for a meeting that is being held online.
 *
 * Returns "" for anything else: an office or site meeting's `location` is an
 * address somebody types, and quietly overwriting it with a video link would
 * lose the only copy of where to actually go.
 */
export const newMeetLink = (mode) =>
  mode === "online" ? `https://meet.google.com/${newMeetCode()}` : "";

/** Is this location a link somebody can click, rather than an address? */
export const isMeetingLink = (location = "") => /^https?:\/\//i.test(String(location).trim());
