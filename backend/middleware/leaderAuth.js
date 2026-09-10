import jwt from "jsonwebtoken";
import User, { LEADER_ROLES } from "../models/User.js";
import Project from "../models/Project.js";
import Team, { ACTIVE_TEAM } from "../models/Team.js";

// Verify the bearer token and make sure the account is an operations manager.
const leaderAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "Not authorized", code: "AUTH" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (!user || !LEADER_ROLES.includes(user.role)) {
      return res.status(403).json({ message: "Operations Manager access only", code: "AUTH" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ message: "This account is inactive", code: "AUTH" });
    }

    /**
     * The token was minted for a session that has since been ended — a
     * sign-out, a password change, or an admin resetting it. See
     * User.tokenVersion / Client.tokenVersion.
     */
    if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      return res
        .status(401)
        .json({ message: "This session has ended. Please sign in again.", code: "AUTH" });
    }

    req.leader = user;
    next();
  } catch (err) {
    console.error("leaderAuth error:", err.message);
    return res.status(401).json({ message: "Invalid or expired token", code: "AUTH" });
  }
};

/**
 * Every leader query is scoped to what they own: the projects they lead and
 * the employees reporting to them. Cached on the request so a handler that
 * needs both only pays for one round trip.
 */
/**
 * What this account can see.
 *
 * An operations manager sees the projects they lead and the people who report to them,
 * which is unchanged. A manager sees the same for every team they run — their
 * department, not one project — so a Sales manager reaches all five
 * executives without being made to lead each of them individually.
 */
export const getScope = async (req) => {
  if (req.scope) return req.scope;

  /**
   * The departments this account answers for.
   *
   * Asked of the Team records rather than of the role, because the two do not
   * always agree: an operations manager who was made a team's manager runs that
   * department in every sense the reporting chain cares about, and the work
   * they hand out to it has to reach them. Reading only `role === "manager"`
   * left those people managing a department they could not see.
   *
   * ACTIVE_TEAM rather than `active: true` — a team written before the field
   * existed does not carry it, and this database holds exactly one.
   */
  const managedTeams = await Team.find({ manager: req.leader._id, ...ACTIVE_TEAM }).select(
    "name kind operationsManagers members"
  );

  const isManager = req.leader.role === "manager" || managedTeams.length > 0;

  const departmentIds = [
    ...new Set(
      managedTeams.flatMap((team) =>
        [...(team.operationsManagers || []), ...(team.members || [])].map(String)
      )
    ),
  ];

  const [ledProjects, directReports] = await Promise.all([
    Project.find({ operationsManager: req.leader._id }).distinct("_id"),
    User.find({ reportsTo: req.leader._id }).distinct("_id"),
  ]);

  const teamIds = [
    ...new Set([...directReports.map(String), ...departmentIds]),
  ];

  // A manager also reaches whatever their people are working on
  const projectIds = isManager
    ? [
        ...new Set(
          [
            ...ledProjects.map(String),
            ...(await Project.find({
              $or: [{ members: { $in: teamIds } }, { operationsManager: { $in: teamIds } }],
            }).distinct("_id")).map(String),
          ]
        ),
      ]
    : ledProjects;

  req.scope = {
    projectIds,
    teamIds,
    isManager,
    managedTeamIds: managedTeams.map((t) => t._id),
    // Enough to fill a department dropdown without asking for the teams again
    managedTeams: managedTeams.map((team) => ({ _id: team._id, name: team.name, kind: team.kind })),
  };
  return req.scope;
};

export default leaderAuth;
