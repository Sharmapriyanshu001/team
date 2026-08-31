import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Project from "../models/Project.js";

// Verify the bearer token and make sure the account is a team leader.
const leaderAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "Not authorized", code: "AUTH" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (!user || user.role !== "team_leader") {
      return res.status(403).json({ message: "Team leader access only", code: "AUTH" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ message: "This account is inactive", code: "AUTH" });
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
export const getScope = async (req) => {
  if (req.scope) return req.scope;

  const [projectIds, teamIds] = await Promise.all([
    Project.find({ teamLeader: req.leader._id }).distinct("_id"),
    User.find({ reportsTo: req.leader._id }).distinct("_id"),
  ]);

  req.scope = { projectIds, teamIds };
  return req.scope;
};

export default leaderAuth;
