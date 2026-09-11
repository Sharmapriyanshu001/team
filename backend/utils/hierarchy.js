import Team, { ACTIVE_TEAM } from "../models/Team.js";
import User, { ADMIN_ROLES, HR_ADMIN_ROLE, HR_PANEL_ROLES } from "../models/User.js";

/**
 * Who is above whom.
 *
 * The company runs on one chain:
 *
 *   Team Member  →  Department Manager  →  HR  →  Admin
 *
 * and every report, notification and escalation follows it. Working that out
 * from scratch in each controller is how four screens end up with four subtly
 * different answers to "who is my manager", so it is answered once here.
 *
 * The chain is read from records that already exist rather than from a new
 * parallel structure:
 *
 *   a member's manager   Team.manager of the team they are on,
 *                        falling back to User.reportsTo
 *   a manager's HR       the HR head — there is one HR function, and a
 *                        company with two of them has a reporting problem
 *                        no software can fix
 *   HR's admin           the administrators
 *
 * The fallback in the first line matters. `reportsTo` is how an operations manager
 * gets their people and predates the Teams model, so plenty of employees have
 * a reporting line and no team row. Reading only one of the two would leave
 * half the company with nobody above them.
 */

/** Departments that are real departments rather than a catch-all. */
export const DEPARTMENTS = ["sales", "operations"];

/**
 * The team somebody belongs to, whichever way they belong to it.
 *
 * Manager, operations manager or member — a person is on a team if their id appears
 * anywhere on it, and which of the three they are is a different question.
 */
export const teamOf = async (userId) =>
  Team.findOne({
    ...ACTIVE_TEAM,
    $or: [{ manager: userId }, { operationsManagers: userId }, { members: userId }],
  });

/** Every active administrator, for anything that escalates to "the Admin". */
export const adminIds = async () =>
  User.find({ role: { $in: ADMIN_ROLES }, status: "active" }).distinct("_id");

/**
 * The HR function — every active HR account, not one of them.
 *
 * This started as a findOne on the HR head, which was wrong the moment the
 * company had two: a manager's team update went to whichever record the
 * database returned first, and the other HR accounts never saw it. An admin
 * is explicitly allowed to create as many HR Managers as they need, so HR has
 * to be addressed the way the administrators are — as a function that several
 * people staff, rather than a person.
 */
export const hrIds = async () =>
  User.find({ role: { $in: HR_PANEL_ROLES }, status: "active" }).distinct("_id");

/** For display: somebody to name when the chain is drawn. */
export const anyHr = async () =>
  User.findOne({ role: HR_ADMIN_ROLE, status: "active" }).select("name email role");

/**
 * The whole chain above one person, resolved in one go.
 *
 * Any link may be missing — a member with no team and no reportsTo, a company
 * with no HR account yet — and the callers need to say so rather than crash,
 * so every level is nullable and the shape is always the same.
 */
export const chainFor = async (user) => {
  const team = await teamOf(user._id);

  /**
   * The manager above this person.
   *
   * A manager is not their own manager: if the caller IS the team's manager,
   * the next step up is HR, not themselves. Getting that wrong would make a
   * manager's team update land in their own inbox.
   */
  let manager = null;
  const teamManagerId = String(team?.manager || "");
  const isTeamManager = teamManagerId && teamManagerId === String(user._id);

  if (!isTeamManager) {
    const managerId = team?.manager || user.reportsTo;
    if (managerId) {
      manager = await User.findById(managerId).select("name email role designation");
    }
  }

  const [hr, hrTeam, admins] = await Promise.all([anyHr(), hrIds(), adminIds()]);

  return {
    team: team
      ? { _id: team._id, name: team.name, kind: team.kind, manager: team.manager }
      : null,
    department: team?.kind || "other",
    manager,
    hr,
    hrTeam,
    admins,
    isTeamManager: Boolean(isTeamManager),
  };
};

/**
 * Who this person's report should go to, given what they are.
 *
 * The one place that decides the direction of travel. A controller asks
 * "where does this go" and gets a person and a kind, rather than each of them
 * re-deriving the rule and one of them getting it wrong.
 */
export const reportTargetFor = async (user) => {
  const chain = await chainFor(user);

  /**
   * `to` is a named person; `group` is a function several people staff.
   *
   * Both HR and the administrators are the second kind — a report addressed
   * to one of them by id would be invisible to the others, which is exactly
   * how a company with two HR Managers loses half its reports.
   */

  // HR reports to the administrators
  if (HR_PANEL_ROLES.includes(user.role)) {
    return { kind: "hr_report", to: null, group: chain.admins, groupName: "Administrators", chain };
  }

  // A department manager reports to HR
  if (chain.isTeamManager || user.role === "manager") {
    return { kind: "team_update", to: null, group: chain.hrTeam, groupName: "HR", chain };
  }

  // Everybody else reports to the one person above them
  return { kind: "member_update", to: chain.manager, group: [], groupName: "", chain };
};

/** Every active operations manager, for a member with nobody named above them. */
export const operationsManagerIds = async () =>
  User.find({ role: "operations_manager", status: "active" }).distinct("_id");

/**
 * Where a person may send their report, as a list of choices rather than one
 * answer.
 *
 * `reportTargetFor` above answers "where does this go", and for a manager or
 * for HR that is still the whole truth — there is one step up and it is not a
 * matter of opinion. For a team member it was never quite true: an update
 * about being blocked on a manager, or about leave, or about anything the
 * person above them is the subject of, has nowhere to go if the only address
 * is that person.
 *
 * So a team member gets two: the person above them, and HR. The server still
 * resolves who those actually are — the client sends a key, never an id, so
 * nobody can address a report to somebody who is not above them.
 *
 * WHY NOTHING HERE EVER RETURNS AN EMPTY LIST
 *
 * A member with no team and no `reportsTo` used to be told to go and ask
 * their manager to add them — which is a report, addressed to the one person
 * they have been told they do not have. Every option falls back until it
 * lands on somebody: the named manager, then the operations managers, then
 * HR, then the administrators. A company with an admin account can always be
 * reported to, and every company has one.
 */
export const reportRecipientsFor = async (user) => {
  const target = await reportTargetFor(user);
  const { chain } = target;

  const option = (key, label, name, ids, group = null) => ({
    key,
    label,
    name,
    ids: ids.filter(Boolean),
    group,
    count: ids.filter(Boolean).length,
  });

  // HR and the administrators are functions; both keep their single address
  if (target.kind !== "member_update") {
    const group = target.kind === "hr_report" ? "admins" : "hr";
    const fallback = target.kind === "hr_report" ? [] : chain.admins;
    const ids = target.group.length ? target.group : fallback;
    const name = target.group.length ? target.groupName : "Administrators";
    const key = target.group.length ? group : "admins";

    return {
      kind: target.kind,
      chain,
      options: [option(key, name, name, ids, key)].filter((o) => o.count),
    };
  }

  const options = [];

  /**
   * The person above them. Named where there is one, and the operations
   * managers as a function where there is not — a member with no reporting
   * line still has an operations side to tell.
   */
  if (chain.manager) {
    options.push(
      option(
        "manager",
        "Operations Manager",
        chain.manager.name,
        [chain.manager._id]
      )
    );
  } else {
    const ops = await operationsManagerIds();
    if (ops.length) {
      options.push(option("manager", "Operations Manager", "Operations Managers", ops, "operations"));
    }
  }

  // HR, always — and the administrators if the company has no HR account yet
  if (chain.hrTeam.length) {
    options.push(option("hr", "HR", "HR", chain.hrTeam, "hr"));
  } else if (chain.admins.length) {
    options.push(option("hr", "HR", "Administrators", chain.admins, "admins"));
  }

  return { kind: target.kind, chain, options };
};

/**
 * Everybody below one person, for an inbox.
 *
 * A manager sees their team; HR sees every manager; an admin sees everything.
 * Returned as ids so a caller can put them straight into a query.
 */
export const reportsToMe = async (user) => {
  if (ADMIN_ROLES.includes(user.role)) return null; // null means "no limit"

  if (HR_PANEL_ROLES.includes(user.role)) {
    // Every department manager, however they got the job
    const [managers, teamManagers] = await Promise.all([
      User.find({ role: "manager", status: "active" }).distinct("_id"),
      Team.find({ ...ACTIVE_TEAM }).distinct("manager"),
    ]);
    return [...new Set([...managers, ...teamManagers].filter(Boolean).map(String))];
  }

  const team = await teamOf(user._id);
  const isManager = String(team?.manager || "") === String(user._id);

  const direct = await User.find({ reportsTo: user._id }).distinct("_id");

  if (isManager) {
    const onTeam = [...(team.operationsManagers || []), ...(team.members || [])];
    return [...new Set([...onTeam, ...direct].map(String))];
  }

  return [...new Set(direct.map(String))];
};
