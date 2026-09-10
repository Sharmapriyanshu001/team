import { SALES_ADMIN_ROLE, SALES_PANEL_ROLES } from "../models/User.js";

/**
 * What the Sales panel contains, and which of it each sales role may reach.
 *
 * A short, closed list on purpose — everything under /api/sales is sales work
 * by construction, so there is no module here that could expose a project's
 * source code, an employee's Aadhaar or the credential vault. Those are not
 * reachable from this panel at all, whatever a role says.
 *
 * The module list is therefore only half the story, and the smaller half. The
 * important control in this panel is not *which screens* but *which rows*:
 * an executive sees the leads assigned to them and no one else's. That is
 * `scopeFor` below, and it is applied in the queries rather than the menus.
 */

/** Every section of the Sales panel. Mirrors the sidebar. */
export const SALES_MODULES = [
  "dashboard",
  "leads",
  "followups",
  "activities",
  "requirements",
  "quotations",
  "clients",
  "deals",
  // What Sales sold, and who in Operations is carrying it
  "projects",
  "revenue",
  "tasks",
  "team",
  "reports",
  "notifications",
  "profile",
];

const ALL = ["view", "create", "edit", "delete"];
const VIEW = ["view"];
const WRITE = ["view", "create", "edit"];

/**
 * The sales floor's shared access.
 *
 * An executive is not a junior with a cut-down panel — they run their own
 * deals end to end, so they get the same modules. What differs is the rows
 * those modules return, and one screen they do not get at all.
 *
 * Deleting is withheld from both: a lead carries the history of every call
 * made against it, and removing one to tidy a list destroys the only record
 * that the work happened. Losing a deal is a stage, not a delete.
 */
const SALES_FLOOR = {
  dashboard: VIEW,
  leads: WRITE,
  followups: ALL,
  activities: WRITE,
  requirements: ALL,
  quotations: WRITE,
  clients: WRITE,
  deals: WRITE,
  /**
   * Read-only for the floor.
   *
   * An executive should be able to answer "how is my client's build going"
   * without ringing Operations, and should not be able to change the answer.
   * Naming who delivers a project is the head's, and every other field on it
   * belongs to whoever is answering for the date — see
   * controllers/sales/projectController.js.
   */
  projects: VIEW,
  revenue: VIEW,
  /**
   * Department tasks: the work a sales manager hands to their own executives.
   *
   * An executive holds view and edit rather than create, and the edit they
   * hold is narrower than the word suggests — the handler lets an assignee
   * move the status and nothing else. Somebody who could rewrite the task
   * they were given could quietly change what they were asked to do, which
   * defeats the point of having asked in writing.
   */
  tasks: ["view", "edit"],
  reports: VIEW,
  notifications: ["view", "edit"],
  profile: ["view", "edit"],
};

/**
 * Work out what this sales account may do.
 *
 * `team` is the whole difference between the two roles. An account that can
 * create sales logins can create another head, so exactly one role holds it —
 * the same rule the HR panel draws around its manager screens.
 */
export const salesPermissionsFor = (user) => {
  const isSalesHead = user?.role === SALES_ADMIN_ROLE;

  return {
    isSalesHead,
    role: user?.role || "",
    modules: {
      ...SALES_FLOOR,
      // The head also reassigns leads between people, which is an edit on the
      // lead but only meaningful if you can see everybody's.
      ...(isSalesHead
        ? {
            team: ALL,
            tasks: ALL,
            leads: ALL,
            clients: ALL,
            revenue: WRITE,
            // The handover to Operations. An edit on the project, not a create.
            projects: WRITE,
          }
        : {}),
    },
  };
};

/** Does this sales account hold `action` on `module`? */
export const salesCan = (user, module, action = "view") =>
  (salesPermissionsFor(user).modules[module] || []).includes(action);

/* --------------------------------------------------------------- scoping */

/**
 * Which rows this account may see.
 *
 * The head sees the whole pipeline — that is what running a sales team means.
 * An executive sees what has been assigned to them, and nothing else.
 *
 * Returned as query fragments rather than as a boolean the callers have to
 * remember to act on. A handler that spreads `scope.lead` into its query is
 * scoped; one that forgets is obviously unscoped when you read it, which is
 * the point. Every list, detail, update and delete in this panel goes through
 * one of these.
 */
export const scopeFor = (user) => {
  const isSalesHead = user?.role === SALES_ADMIN_ROLE;
  const id = user?._id;

  if (isSalesHead) {
    return {
      isSalesHead,
      userId: id,
      lead: {},
      client: {},
      /** Activities, follow-ups and requirements hang off a lead or a client. */
      ownedBy: {},
      /** For "is this row mine" checks where a query fragment will not do. */
      owns: () => true,
    };
  }

  return {
    isSalesHead,
    userId: id,
    lead: { owner: id },
    /**
     * A client belongs to the executive who owns it or manages the account.
     * Both fields exist on Client already — `owner` is written when a lead is
     * converted, `accountManager` when the account is handed on.
     */
    client: { $or: [{ owner: id }, { accountManager: id }] },
    ownedBy: { assignedTo: id },
    owns: (doc) =>
      String(doc?.owner || "") === String(id) ||
      String(doc?.accountManager || "") === String(id) ||
      String(doc?.assignedTo || "") === String(id),
  };
};

/**
 * The refusal an executive gets when they reach for somebody else's row.
 *
 * Deliberately the same message and status as "it does not exist". Telling
 * somebody that a lead exists but is not theirs is how a sales floor learns
 * the shape of a colleague's pipeline one 403 at a time.
 */
export const notYours = (res, what = "That record") =>
  res.status(404).json({ message: `${what} was not found` });

/* ------------------------------------------------------ the reporting line */

/**
 * Who a sales manager's team actually is.
 *
 * Sales used to be one flat floor: every manager's Team screen listed every
 * sales account in the company, so two managers running two teams saw — and
 * could edit, deactivate or delete — each other's people. `reportsTo` is what
 * makes "my team" mean something, and it is written when the manager opens
 * the account rather than picked from a dropdown afterwards, because the
 * person who hires somebody is the person they report to.
 *
 * Returned as a query fragment for the same reason the row scopes above are:
 * a handler that spreads it into its query is scoped, and one that forgets is
 * obviously unscoped when you read it.
 */
export const teamFilterFor = (user) => ({
  role: { $in: SALES_PANEL_ROLES },
  $or: [{ reportsTo: user?._id }, { _id: user?._id }],
});

/**
 * The executives nobody is managing.
 *
 * Every sales account that existed before the reporting line did has an empty
 * `reportsTo`, and a strict "only my team" filter would have made all of them
 * vanish from the only screen that manages them. So they are shown apart, as
 * a list a manager can claim from, and the panel converges on a real reporting
 * line one person at a time instead of needing a migration nobody would run.
 *
 * Managers are left out: a second manager with no `reportsTo` is not somebody
 * waiting to be claimed, they run their own team.
 */
export const unclaimedTeamFilter = () => ({
  role: "sales_exec",
  $or: [{ reportsTo: null }, { reportsTo: { $exists: false } }],
});

/**
 * The circle of names this account may hand work or a lead to.
 *
 * A manager gets their own team plus whoever is still unclaimed, so the
 * "assign to" dropdown never comes back empty on a panel whose reporting line
 * has not been filled in yet. An executive gets their manager and the people
 * beside them on the same team — handing a lead sideways to a colleague is
 * ordinary, handing it to another department's floor is not.
 */
export const circleFilterFor = (user) => {
  if (user?.role === SALES_ADMIN_ROLE) {
    return {
      role: { $in: SALES_PANEL_ROLES },
      $or: [
        { _id: user._id },
        { reportsTo: user._id },
        { role: "sales_exec", reportsTo: null },
        { role: "sales_exec", reportsTo: { $exists: false } },
      ],
    };
  }

  const manager = user?.reportsTo;

  return {
    role: { $in: SALES_PANEL_ROLES },
    $or: [
      { _id: user?._id },
      ...(manager ? [{ _id: manager }, { reportsTo: manager }] : []),
    ],
  };
};
