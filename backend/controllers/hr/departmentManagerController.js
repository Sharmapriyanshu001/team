import User from "../../models/User.js";

import { buildCrud } from "../../utils/crud.js";
import { staffCrudOptions } from "../../utils/staffCrud.js";

/**
 * Department managers, from HR's side.
 *
 * These are the `manager` accounts the admin panel has always created: the
 * department heads who run a team and sign in to the operations manager's panel. They
 * are staff, and staff are HR's job, so HR can now open one rather than having
 * to ask an administrator every time somebody is promoted.
 *
 * Built on exactly the same helpers the admin panel uses — utils/staffCrud.js,
 * shared between the two since the HR panel was split out — so a manager HR
 * creates is the same record, with the same validation, the same login rule
 * and the same paperwork handling, as one the admin creates. There is no
 * second definition of what a manager is that could drift from the first.
 *
 * Two things this deliberately does NOT allow, both inherited rather than
 * re-argued:
 *
 *   the role is forced       staffCrudOptions("manager") writes role:"manager"
 *                            on every create and update, so no request body
 *                            can turn this route into a way to mint an admin
 *
 *   no delete                removing somebody takes their name off every task,
 *                            leave and team they ever touched. Deactivating is
 *                            what HR wants nine times out of ten and is a
 *                            plain status edit; the irreversible one stays an
 *                            administrator's call, which is the same line the
 *                            employees routes draw.
 */
export const departmentManagers = buildCrud(User, staffCrudOptions("manager"));

/**
 * GET /api/hr/department-managers/summary
 *
 * The counts above the table. Read straight from the collection so they cannot
 * drift from the rows underneath them.
 */
export const departmentManagerSummary = async (req, res) => {
  try {
    const [total, active] = await Promise.all([
      User.countDocuments({ role: "manager" }),
      User.countDocuments({ role: "manager", status: "active" }),
    ]);

    return res.status(200).json({
      counts: { total, active, inactive: total - active },
    });
  } catch (err) {
    console.error("departmentManagerSummary error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
