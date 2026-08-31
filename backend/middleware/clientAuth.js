import jwt from "jsonwebtoken";
import Client from "../models/Client.js";
import Project from "../models/Project.js";

// Verify the bearer token and make sure it belongs to a client with portal access.
const clientAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "Not authorized", code: "AUTH" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Staff tokens carry a role; a client token never does.
    if (decoded.role) {
      return res.status(403).json({ message: "Client access only", code: "AUTH" });
    }

    const client = await Client.findById(decoded.id).select("-password");

    if (!client) {
      return res.status(403).json({ message: "Client access only", code: "AUTH" });
    }
    if (!client.portalAccess || client.status === "inactive") {
      return res
        .status(403)
        .json({ message: "Portal access is turned off for this account", code: "AUTH" });
    }

    req.client = client;
    next();
  } catch (err) {
    console.error("clientAuth error:", err.message);
    return res.status(401).json({ message: "Invalid or expired token", code: "AUTH" });
  }
};

/** A client sees only the projects booked under their name. */
export const getScope = async (req) => {
  if (req.scope) return req.scope;

  const projectIds = await Project.find({ client: req.client._id }).distinct("_id");

  req.scope = { projectIds };
  return req.scope;
};

export default clientAuth;
