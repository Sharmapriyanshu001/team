import { DEPARTMENT_LABELS, DEPARTMENT_ROLES } from "../models/User.js";

/**
 * What each department account may do when nobody has said otherwise.
 *
 * These are defaults in code rather than rows seeded into the database, for
 * one reason: a department account must never be able to exist in an
 * unrestricted state, not even for the moment between it being created and
 * somebody remembering to attach a role to it. A plain admin with no role
 * assigned is unrestricted — that is deliberate and predates this file — so a
 * department account falling through the same branch would quietly be a second
 * super admin. It falls through to here instead.
 *
 * An admin who wants a different shape builds a Role in Roles & Permissions
 * and assigns it; that always wins over what is written here. So this is the
 * floor, not the ceiling, and changing somebody's access never means editing
 * this file.
 *
 * The three sets follow the company flow the panel is organised around:
 *
 *   HR           the people: who works here, who is joining, who is away
 *   Sales        the money coming in: leads, quotations, invoices, clients
 *   Operations   the delivery: projects, teams, tasks, code, issues, files
 *
 * Every department gets the dashboard, chat and reports — those are how a
 * person orients themselves and talks to the rest of the company, and a
 * department that can see neither is a department working blind.
 */

const ALL = ["view", "create", "edit", "delete"];
const VIEW = ["view"];
const WRITE = ["view", "create", "edit"];

/** Given to every department, whatever else they hold. */
const COMMON = {
  dashboard: VIEW,
  chat: ["view", "create"],
  reports: VIEW,
};

export const DEPARTMENT_PERMISSIONS = {
  hr: {
    ...COMMON,
    employees: ALL,
    operations_managers: ALL,
    leaves: ALL,
    recruitment: ALL,
    // Who is on which department, and the numbers they carry. HR sets neither
    // but cannot staff a team it is not allowed to look at.
    teams: WRITE,
    // Work that is HR's own — chasing a signed offer letter, collecting
    // documents — lives on the task board like everybody else's.
    tasks: WRITE,
  },

  sales: {
    ...COMMON,
    // The pipeline, the rate card, quotations, invoices and payments
    crm: ALL,
    clients: ALL,
    // Sales does not run delivery, but selling the next phase of a project
    // means being able to see how the last one went.
    projects: VIEW,
    teams: VIEW,
    tasks: WRITE,
    files: VIEW,
  },

  /**
   * A sales executive, if one is ever admitted to the admin panel again.
   *
   * They are not there today — sales roles live at /api/sales — and
   * permissionsFor() fails closed to {} for a role with no entry here, which
   * is safe but silent: the account would sign in to a panel with nothing in
   * it and no explanation of why. This is the sensible floor for that day, and
   * narrower than the head lot on purpose.
   */
  sales_exec: {
    ...COMMON,
    crm: WRITE,
    clients: VIEW,
    tasks: WRITE,
  },

  operations: {
    ...COMMON,
    projects: ALL,
    tasks: ALL,
    issues: ALL,
    files: ALL,
    employees: VIEW,
    operations_managers: VIEW,
    teams: WRITE,
    // Delivery is what these four are: the browser workspace, the review
    // queue, the Play consoles and the retainer work.
    code_projects: ALL,
    code: ALL,
    play_console: ALL,
    seo: ALL,
    ads: ALL,
    // Whose work this is. Reading the client record is not the same as being
    // able to edit the commercial terms on it, so this stops at view.
    clients: VIEW,
  },
};

/** The default permission map for a department, as a plain object. */
export const defaultPermissionsFor = (role) => DEPARTMENT_PERMISSIONS[role] || {};

export const isDepartmentRole = (role) => DEPARTMENT_ROLES.includes(role);

/**
 * Which door each department account signs in at.
 *
 * HR has a panel of its own, and its accounts are refused by the admin login —
 * so an administrator who creates one and reads out the credentials without
 * being told this sends somebody to a page that will not let them in. The
 * form says it, because the form is where the mistake would be made.
 */
/**
 * Everybody signs in at the same address now, so the path no longer varies by
 * role — the server works out which panel the account belongs to and sends
 * them there. See utils/panels.js.
 *
 * The label still does vary, and still matters: an administrator handing over
 * a login needs to be able to say "this is a Sales account", even though the
 * door is the same door.
 */
const SIGN_IN_AT = "/";

export const DEPARTMENT_PORTALS = {
  hr: { label: "HR panel", path: SIGN_IN_AT },
  hr_manager: { label: "HR panel", path: SIGN_IN_AT },
  sales: { label: "Sales panel", path: SIGN_IN_AT },
  sales_exec: { label: "Sales panel", path: SIGN_IN_AT },
  operations: { label: "Admin panel", path: SIGN_IN_AT },
};

export const portalFor = (role) => DEPARTMENT_PORTALS[role] || DEPARTMENT_PORTALS.sales;

export const departmentLabel = (role) => DEPARTMENT_LABELS[role] || "";

/**
 * The department accounts, described for the panel's own forms so the list of
 * what can be created lives in one place.
 */
export const DEPARTMENT_OPTIONS = DEPARTMENT_ROLES.map((role) => ({
  value: role,
  label: DEPARTMENT_LABELS[role],
  modules: Object.keys(DEPARTMENT_PERMISSIONS[role] || {}).sort(),
  // Where this account actually signs in — HR does not use the admin login
  portal: DEPARTMENT_PORTALS[role] || DEPARTMENT_PORTALS.sales,
}));
