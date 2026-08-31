import ActivityLog from "../models/ActivityLog.js";

// Fire-and-forget audit trail. A logging failure must never break the request.
// The actor is whichever panel authenticated the request.
export const logActivity = (req, { action, entity, entityId, message }) => {
  const actor = req.admin || req.leader || req.employee || req.client;

  ActivityLog.create({
    // `actor` refs User, so a client's id is left off — the name still shows.
    actor: req.client ? undefined : actor?._id,
    actorName: actor?.name || "System",
    action,
    entity,
    entityId,
    message,
  }).catch((err) => console.error("logActivity error:", err.message));
};
