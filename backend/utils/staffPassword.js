import { comparePassword } from "./password.js";

/**
 * The first password a new staff account gets, and how to read one back.
 *
 * Six screens open staff logins — the admin's staff form, department accounts,
 * HR's employees, HR's three manager screens, the sales floor — and each of
 * them used to carry its own copy of this rule. Six copies of "what is their
 * password" is six chances for the answer to differ, and the person on the
 * phone asking why they cannot sign in has no way to tell which copy was
 * wrong. So it is answered here, once.
 */

/**
 * What an account starts with when whoever opened it did not type a password.
 *
 * It was the person's mobile number, which read as a nice touch and was not
 * one: it changed when they updated their number, it was different for every
 * account so nobody could be told it in advance, and it was still a password a
 * stranger holding a business card could type. A known starting password is
 * not weaker than that — it is the same weakness, said out loud, which is what
 * makes "change it on first sign-in" a sentence somebody can actually act on.
 */
export const DEFAULT_PASSWORD = "123456";

/**
 * The mobile number, as the old rule handed it out.
 *
 * Kept only for reading accounts back, never for setting one. Everybody opened
 * before this changed still has it, and an admin who cannot be told the
 * password they are looking at has to reset a working login to find out.
 */
const phoneOf = (record) => String(record?.phone || "").trim();

/**
 * What password to store, given what the form sent.
 *
 *   typed                → that, if it is long enough
 *   nothing, new account → the default above
 *   nothing, an edit     → null, meaning leave the stored one alone
 *
 * `null` and a password are deliberately different answers rather than one
 * falsy value: an edit that says nothing about the password must not quietly
 * reset it, which is what "falsy means default" would do on every profile save.
 */
export const resolvePassword = (body, existing) => {
  const typed = String(body?.password || "").trim();

  if (typed) {
    if (typed.length < 6) return { error: "Password must be at least 6 characters" };
    return { password: typed, wasTyped: true };
  }

  if (!existing) return { password: DEFAULT_PASSWORD, wasTyped: false };

  return { password: null, wasTyped: false };
};

/**
 * The login to show on a staff record.
 *
 * The stored password is a one-way scrypt hash and cannot be read back. What
 * can be done is test it against the passwords this system is known to hand
 * out — so an admin can tell somebody their login instead of resetting a
 * working account to find out what it is.
 *
 * Two are tried, and which one matched is reported rather than assumed. The
 * default above is what new accounts get; the mobile number is what accounts
 * opened under the old rule still have, and calling those "changed" would send
 * an admin resetting a password that was never touched.
 *
 * Nothing is inferred from a miss. A password that matches neither is one the
 * person chose, and the only honest thing to say about it is that nobody else
 * knows it.
 */
export const credentialsFor = (record, portal) => {
  const stored = record?.password;
  const phone = phoneOf(record);

  const candidates = [
    { password: DEFAULT_PASSWORD, kind: "starting" },
    ...(phone ? [{ password: phone, kind: "phone" }] : []),
  ];

  const match = stored ? candidates.find((one) => comparePassword(one.password, stored)) : undefined;

  return {
    loginId: record?.email || "",
    password: match ? match.password : null,
    isDefault: Boolean(match),
    /** "starting", "phone", or null — the screen says which rather than guessing. */
    defaultKind: match?.kind || null,
    hasPassword: Boolean(stored),
    portal,
  };
};
