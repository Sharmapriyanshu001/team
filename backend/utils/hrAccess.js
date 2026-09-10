import { HR_ADMIN_ROLE } from "../models/User.js";

/**
 * What the HR panel contains, and which of it each HR role may touch.
 *
 * The admin panel resolves permissions against editable Role documents,
 * because an administrator's access is a thing somebody configures. HR's is
 * not: the panel *is* the permission boundary — every route under /api/hr is
 * HR work by construction, and nothing else is reachable from there at all.
 * So this is a short fixed map rather than another configurable system, and
 * the only real question it answers is the one that varies: whether this
 * account may manage its colleagues' logins.
 *
 * The modules line up one-to-one with the panel's own sidebar, so a screen
 * that is hidden and a route that refuses cannot disagree about what exists.
 */

const ALL = ["view", "create", "edit", "delete"];
const VIEW = ["view"];
const WRITE = ["view", "create", "edit"];

export const HR_MODULES = [
  "dashboard",
  "employees",
  "department_managers",
  "operations_managers",
  "sales_managers",
  "client_records",
  "incentives",
  "hr_managers",
  "attendance",
  "leaves",
  // Hiring: the vacancies, the people applying for them, the rounds they sit
  // and the day one of them becomes an employee. One module, because a person
  // who may see a candidate must be able to see the opening behind them for
  // any of it to mean anything.
  "hiring",
  "recruitment",
  "candidates",
  "documents",
  "reports",
  // The departments themselves — opening a new one, and correcting the name
  // or description of an existing one.
  "departments",
  "settings",
];

/**
 * Both roles get the same HR work. An HR Manager is not a junior with a
 * cut-down panel — they do the job — so the difference is exactly one module.
 */
const SHARED = {
  dashboard: VIEW,
  employees: WRITE,
  /**
   * Department heads are staff, so HR opens their logins — and now closes
   * them. This was WRITE, on the reasoning that deleting somebody takes their
   * name off every task and team they ever touched and so belonged to an
   * administrator. In practice HR is the department that processes an exit,
   * and routing the last step through somebody else meant closed accounts sat
   * open for weeks.
   *
   * The check that actually protects the records is not who holds the button:
   * deactivating is the ordinary way to close an account and keeps everything
   * the person decided, and the screen offers it first. Deletion is the
   * deliberate second choice, and it asks before it happens.
   */
  department_managers: ALL,
  /**
   * Operations managers, on the same terms as the department heads above.
   *
   * Granting one and withholding the other would be a distinction nobody
   * asked for: both are senior staff, both are onboarded by HR, and the
   * admin panel already guards its two screens with a single module for
   * exactly that reason. HR was able to open a department head's login and
   * not an operations manager's, which is the hire it makes most often.
   */
  operations_managers: ALL,
  // Opening a Sales Manager's login is onboarding, which is HR's job. ALL
  // rather than WRITE because HR is the department that closes an account
  // when somebody leaves — and the route refuses a delete while the person
  // still owns live deals, which is the check that actually matters.
  sales_managers: ALL,
  // What Sales has sent through. Read-only: HR is not running the
  // commercial relationship, so this answers what has arrived rather than
  // offering to change it.
  client_records: VIEW,
  // The incentive scheme feeds the bonus, and the bonus is payroll, which
  // is HR's. ALL because awarding and deducting points by hand is the
  // part of the scheme only a person can do.
  incentives: ALL,
  attendance: ALL,
  leaves: ALL,
  hiring: ALL,
  recruitment: ALL,
  candidates: ALL,
  documents: VIEW,
  /**
   * HR writes as well as reads.
   *
   * The analytics screen under this module is read-only and has no write
   * endpoints, so this grants nothing there. What it does grant is HR's own
   * job in the reporting chain: receiving a manager's team update, answering
   * it, and submitting the company report up to the administrators. VIEW-only
   * left HR unable to do the middle of the chain at all.
   */
  reports: WRITE,
  /**
   * HR opens departments.
   *
   * A department is a team record, and until now only an administrator could
   * create one — which meant HR, who staffs it and appoints its manager, had
   * to ask somebody else to bring it into existence first.
   *
   * WRITE rather than ALL for the same reason employees stop there: deleting
   * a department detaches every target, report and team member filed against
   * it, and that stays an administrator's call. Archiving is the ordinary way
   * to close one down.
   */
  departments: WRITE,
  settings: VIEW,
};

/**
 * What this account may do, by module.
 *
 * `hr_managers` is the whole difference between the two roles, and it is
 * withheld rather than granted: an HR Manager who could create HR accounts
 * could create an HR head, and the distinction would mean nothing by the
 * afternoon.
 */
export const hrPermissions = (role) => ({
  ...SHARED,
  ...(role === HR_ADMIN_ROLE ? { hr_managers: ALL, settings: WRITE } : {}),
});

export const hrCan = (role, module, action = "view") =>
  (hrPermissions(role)[module] || []).includes(action);

/** True for the HR head, who answers for the team's logins. */
export const isHrAdmin = (role) => role === HR_ADMIN_ROLE;
