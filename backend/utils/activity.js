import ActivityLog from "../models/ActivityLog.js";
import { clientOf } from "./actor.js";

// Fire-and-forget audit trail. A logging failure must never break the request.
// The actor is whichever panel authenticated the request.
export const logActivity = (req, { action, entity, entityId, message }) => {
  // req.hr is the HR panel's account — added when HR got a panel of its own,
  // without which every HR action was logged against "System"
  const asClient = clientOf(req);
  const actor = req.admin || req.hr || req.sales || req.leader || req.employee || asClient;

  ActivityLog.create({
    /**
     * `actor` refs User, so a client's id is left off — the name still shows.
     *
     * Asked through clientOf rather than `req.client ? …`, which was always
     * truthy and therefore dropped the id on every entry this function has
     * ever written. See the warning in utils/actor.js.
     */
    actor: asClient ? undefined : actor?._id,
    actorName: actor?.name || "System",
    action,
    entity,
    entityId,
    message,
  }).catch((err) => console.error("logActivity error:", err.message));
};
