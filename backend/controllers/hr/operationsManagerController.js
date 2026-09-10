import User from "../../models/User.js";

import { buildCrud } from "../../utils/crud.js";
import { staffCrudOptions } from "../../utils/staffCrud.js";

/**
 * Operations managers, from HR's side.
 *
 * The other half of a gap the department-managers screen only closed once. HR
 * could open a login for a department head but not for an operations manager —
 * the person who actually runs the projects and whom every employee reports to
 * — so the one hire HR makes most often was the one hire HR had to ask an
 * administrator for.
 *
 * These are the same `operations_manager` records the admin panel creates,
 * built on the same helpers (utils/staffCrud.js), so an operations manager HR
 * opens is the same row, with the same validation, the same login rule and the
 * same paperwork handling, as one an administrator opens. There is no second
 * definition of what an operations manager is that could drift from the first.
 *
 * Two things inherited rather than re-argued, both the same as the department
 * managers beside it:
 *
 *   the role is forced       staffCrudOptions("operations_manager") writes the
 *                            role on every create and update, so no request
 *                            body can turn this route into a way to mint an
 *                            administrator
 *
 *   deleting is second       removing somebody takes their name off every
 *                            project, task and team they ever touched, and
 *                            leaves whoever reported to them reporting to a
 *                            record that is gone. Deactivating is what HR
 *                            wants nine times out of ten and is a plain status
 *                            edit; the screen offers it first and asks before
 *                            either.
 */
export const operationsManagers = buildCrud(User, staffCrudOptions("operations_manager"));

/**
 * GET /api/hr/operations-managers/summary
 *
 * The counts above the table. Read straight from the collection so they cannot
 * drift from the rows underneath them.
 */
export const operationsManagerSummary = async (req, res) => {
  try {
    const [total, active] = await Promise.all([
      User.countDocuments({ role: "operations_manager" }),
      User.countDocuments({ role: "operations_manager", status: "active" }),
    ]);

    return res.status(200).json({
      counts: { total, active, inactive: total - active },
    });
  } catch (err) {
    console.error("operationsManagerSummary error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
