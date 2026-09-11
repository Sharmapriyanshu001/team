/**
 * The password a new staff login starts with.
 *
 * Must match DEFAULT_PASSWORD in backend/utils/staffPassword.js — the server
 * is what actually stores it, and this copy exists only so the forms can show
 * what is about to happen before it happens. A form that promises one password
 * and a server that stores another is the worst of the two, so if one of these
 * moves, move both.
 */
export const DEFAULT_PASSWORD = "123456";

/**
 * What to say underneath a password that has not been changed.
 *
 * `defaultKind` comes from the server, which tests the stored hash against the
 * passwords this system has handed out and reports which one matched — see
 * backend/utils/staffPassword. Saying "their mobile number" about an account
 * that starts with 123456 would send an admin reading out the wrong one.
 */
export const passwordNote = ({ isDefault, defaultKind } = {}) => {
  if (!isDefault) return "They have changed it — only they know it now";
  if (defaultKind === "phone") return "Still the old default — their mobile number";
  return "Still the starting password — ask them to change it";
};
