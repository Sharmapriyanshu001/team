import jwt from "jsonwebtoken";

/**
 * Every panel's session token, minted in one place.
 *
 * Each of the four auth controllers used to carry its own copy of this. That
 * was fine while the payload was three obvious fields, and stopped being fine
 * the moment `tv` was added: a session-version check is only worth anything if
 * every token carries the number, and four copies of the same three lines is
 * how one of them quietly does not.
 *
 * The split between the two functions is the one thing that must not be
 * flattened. clientAuth tells staff and clients apart by asking whether the
 * token carries a `role` — so a client token must never grow one, and a staff
 * token must never lose one.
 */

const EXPIRES_IN = "7d";

const sign = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: EXPIRES_IN });

/** Admin, super admin, team leader, employee. */
export const signStaffToken = (user) =>
  sign({
    id: user._id,
    email: user.email,
    role: user.role,
    tv: user.tokenVersion || 0,
  });

/** A client of the portal. Deliberately carries no `role`. */
export const signClientToken = (client) =>
  sign({
    id: client._id,
    email: client.email,
    tv: client.tokenVersion || 0,
  });
