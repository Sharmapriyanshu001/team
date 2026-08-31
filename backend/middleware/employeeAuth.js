import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Project from "../models/Project.js";

// Verify the bearer token and make sure the account is an employee.
const employeeAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "Not authorized", code: "AUTH" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (!user || user.role !== "employee") {
      return res.status(403).json({ message: "Employee access only", code: "AUTH" });
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

    req.employee = user;
    next();
  } catch (err) {
    console.error("employeeAuth error:", err.message);
    return res.status(401).json({ message: "Invalid or expired token", code: "AUTH" });
  }
};

/**
 * An employee sees the projects they are a member of. Cached on the request
 * so a handler needing it more than once only pays for one round trip.
 */
export const getScope = async (req) => {
  if (req.scope) return req.scope;

  const projectIds = await Project.find({ members: req.employee._id }).distinct("_id");

  req.scope = { projectIds, leaderId: req.employee.reportsTo || null };
  return req.scope;
};

export default employeeAuth;
