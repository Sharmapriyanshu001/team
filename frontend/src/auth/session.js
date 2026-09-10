/**
 * Where a signed-in browser already is, and where a fresh login should go.
 *
 * Every panel keeps its own token under its own key so an administrator and a
 * client can be signed in side by side in one browser. That has always been
 * true; what is new is that one page now has to look across all of them —
 * to answer "is anybody signed in here" before showing a login form.
 */

/**
 * Every panel's storage slots and its path.
 *
 * Mirrors backend/utils/panels.js, which is the authority: the login response
 * carries `path`, `tokenKey` and `userKey`, so this list is NOT consulted to
 * decide where somebody goes after signing in. It is only used to notice a
 * session that already exists, and to clear them all on the way out.
 */
export const PANELS = [
  { key: "admin", path: "/admin", tokenKey: "adminToken", userKey: "admin" },
  { key: "hr", path: "/hr", tokenKey: "hrToken", userKey: "hr" },
  { key: "sales", path: "/sales", tokenKey: "salesToken", userKey: "sales" },
  { key: "operations", path: "/operation-manager", tokenKey: "leaderToken", userKey: "leader" },
  { key: "employee", path: "/employee", tokenKey: "employeeToken", userKey: "employee" },
  { key: "client", path: "/client", tokenKey: "clientToken", userKey: "client" },
];

/** localStorage throws in a private window with site data blocked. */
const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * The panel this browser is already signed in to, if exactly one is.
 *
 * Returns null when several are — somebody signed in as two people on purpose
 * should be shown the login and allowed to choose, not sent to whichever
 * happened to be first in the list.
 */
export const currentSession = () => {
  const live = PANELS.filter((panel) => read(panel.tokenKey));
  return live.length === 1 ? live[0] : null;
};

/**
 * Save what the login handed back.
 *
 * The keys come from the server rather than from the list above, so a panel
 * added on the server needs no change here — the response says where to put
 * the token and where to send the browser.
 */
export const storeSession = ({ token, tokenKey, userKey, user }) => {
  try {
    localStorage.setItem(tokenKey, token);
    localStorage.setItem(userKey, JSON.stringify(user || {}));
  } catch {
    // A browser refusing storage cannot hold a session; the request that
    // follows will 401 and land back here, which is the honest outcome.
  }
};

/** Clear every panel's session. Used by the login page's "not you?" escape. */
export const clearAllSessions = () => {
  PANELS.forEach((panel) => {
    try {
      localStorage.removeItem(panel.tokenKey);
      localStorage.removeItem(panel.userKey);
    } catch {
      /* nothing to clear */
    }
  });
};
