import Team, { ACTIVE_TEAM, TEAM_KINDS } from "../models/Team.js";

/**
 * Which department somebody belongs to.
 *
 * There are two records that answer this and they do not always agree. The
 * Team rows are the real answer — a team says plainly who is on it and what
 * kind of work it does — and `User.department` is the free-text field that
 * predates them, still the only answer for anybody nobody has put on a team
 * yet. So: the teams first, the word on the record second.
 *
 * The free text is only believed when it names a department the company
 * actually has. "Development", "Backend", "Design" describe a job rather than
 * a department, and reading one of them as an answer would be worse than
 * reading none: an answer is what gets somebody excluded from a list.
 */

/** Aliases people actually type for the kinds the Team model defines. */
const ALIASES = {
  ops: "operations",
  operation: "operations",
  delivery: "operations",
  "human resource": "hr",
  "human resources": "hr",
  account: "accounts",
  finance: "accounts",
  marketing: "marketing",
  sale: "sales",
};

/** A department name as written by a person, mapped to a team kind — or "". */
export const kindFromText = (value) => {
  const word = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+(team|department|dept\.?)$/, "");

  if (!word) return "";
  if (TEAM_KINDS.includes(word)) return word;
  return ALIASES[word] || "";
};

/**
 * Every active team, read once, as `person id -> the kinds they are part of`.
 *
 * One query rather than one per person: a picker asks this about the whole
 * staff list at once, and a company has a handful of teams and hundreds of
 * people. Manager, operations manager and member all count — the question is
 * which department somebody is in, not what they do inside it.
 */
export const departmentMap = async () => {
  const teams = await Team.find(ACTIVE_TEAM).select("kind manager operationsManagers members");

  const map = new Map();

  const add = (id, kind) => {
    if (!id || !kind) return;
    const key = String(id._id || id);
    map.set(key, (map.get(key) || new Set()).add(kind));
  };

  teams.forEach((team) => {
    add(team.manager, team.kind);
    (team.operationsManagers || []).forEach((id) => add(id, team.kind));
    (team.members || []).forEach((id) => add(id, team.kind));
  });

  return map;
};

/** The departments one person belongs to. Empty means nobody has said. */
export const departmentsOf = (user, map) => {
  const fromTeams = map.get(String(user._id));
  if (fromTeams?.size) return [...fromTeams];

  const named = kindFromText(user.department);
  return named ? [named] : [];
};

/**
 * Are these two in the same department?
 *
 * Yes when they share one. Yes, also, when either side's department is
 * unknown — an absent answer is not evidence of belonging somewhere else, and
 * treating it as one would empty the picker in any company that has not
 * finished filling in its teams, which is the failure this list has already
 * been rescued from once. No only when both are known and neither matches.
 */
export const sameDepartment = (mine, theirs) => {
  if (!mine.length || !theirs.length) return true;
  return theirs.some((kind) => mine.includes(kind));
};

/** For a sentence on screen: "Operations", "Sales and Operations", or "". */
export const DEPARTMENT_LABEL = {
  hr: "HR",
  sales: "Sales",
  operations: "Operations",
  accounts: "Accounts",
  marketing: "Marketing",
  other: "Other",
};

export const labelDepartments = (kinds = []) => {
  const names = kinds.map((kind) => DEPARTMENT_LABEL[kind] || kind);
  if (names.length < 2) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};
