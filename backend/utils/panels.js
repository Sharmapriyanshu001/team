import {
  ADMIN_PANEL_ROLES,
  HR_PANEL_ROLES,
  LEADER_ROLES,
  SALES_PANEL_ROLES,
} from "../models/User.js";

/**
 * Which panel each role belongs to.
 *
 * There is one login page now, so something has to answer "where does this
 * person go" — and that answer must be the same one every panel's middleware
 * would give, or the login sends somebody to a door that then refuses them.
 *
 * So the map is DERIVED from the role lists the middleware already uses rather
 * than typed out again. adminAuth checks ADMIN_PANEL_ROLES; this reads the
 * same constant. A role added to one of those lists starts routing correctly
 * without anybody remembering this file exists, which is the only way two
 * lists like these stay in step.
 *
 * `tokenKey` and `userKey` are the browser's storage slots. Each panel keeps
 * its own pair so an administrator and a client can be signed in side by side
 * in one browser — that predates this file and is not changed by it. What the
 * login now does is hand back WHICH pair to use rather than each login page
 * knowing its own.
 */

const PANELS = {
  admin: {
    key: "admin",
    label: "Admin",
    path: "/admin",
    tokenKey: "adminToken",
    userKey: "admin",
    roles: ADMIN_PANEL_ROLES,
  },
  hr: {
    key: "hr",
    label: "Human Resources",
    path: "/hr",
    tokenKey: "hrToken",
    userKey: "hr",
    roles: HR_PANEL_ROLES,
  },
  sales: {
    key: "sales",
    label: "Sales",
    path: "/sales",
    tokenKey: "salesToken",
    userKey: "sales",
    roles: SALES_PANEL_ROLES,
  },
  operations: {
    key: "operations",
    label: "Operations Manager",
    path: "/operation-manager",
    tokenKey: "leaderToken",
    userKey: "leader",
    roles: LEADER_ROLES,
  },
  employee: {
    key: "employee",
    label: "Employee",
    path: "/employee",
    tokenKey: "employeeToken",
    userKey: "employee",
    /** employeeAuth checks the role directly rather than against a list. */
    roles: ["employee"],
  },
};

/**
 * The client portal. Kept out of the map above because a client is not a User
 * and carries no role — clientAuth tells the two apart by exactly that, so a
 * client must never be looked up through the role table.
 */
export const CLIENT_PANEL = {
  key: "client",
  label: "Client",
  path: "/client",
  tokenKey: "clientToken",
  userKey: "client",
};

/* --------------------------------------------------------------- the map */

const byRole = {};

Object.values(PANELS).forEach((panel) => {
  panel.roles.forEach((role) => {
    /**
     * Two panels claiming one role would make the login's answer depend on the
     * order of this object, which is not a thing anybody should have to reason
     * about. Thrown at module load, so it is a boot failure rather than a
     * person landing in the wrong place.
     */
    if (byRole[role]) {
      throw new Error(
        `Role "${role}" is claimed by both ${byRole[role].key} and ${panel.key} panels`
      );
    }
    byRole[role] = panel;
  });
});

/** Where this role signs in. Null for a role no panel accepts. */
export const panelForRole = (role) => byRole[role] || null;

/** Everything a browser needs to store a session and go to the right place. */
export const panelSession = (panel) => ({
  panel: panel.key,
  label: panel.label,
  path: panel.path,
  tokenKey: panel.tokenKey,
  userKey: panel.userKey,
});

export default PANELS;
