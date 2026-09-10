/**
 * Who is making this request, whichever panel authenticated it.
 *
 * Each panel's middleware hangs its account on its own property — req.admin,
 * req.hr, req.sales, req.leader, req.employee, req.client — precisely so the
 * two cannot be confused by shared code that branches on one of them. The cost
 * of that is every handler reachable from more than one panel needing to ask
 * the same question, which several of them were answering with their own local
 * copy of this line, each with a different list.
 *
 * A client is deliberately last and is not a User: callers that need an id to
 * store against a `ref: "User"` field must ask `clientOf` below. The ordering
 * is load-bearing — see the warning on that function.
 */
export const actorOf = (req) =>
  req.admin || req.hr || req.sales || req.leader || req.employee || clientOf(req);

/**
 * The signed-in client, or null — and never Node's socket.
 *
 * `req.client` is an inherited alias for `req.socket` on every Express
 * request, so it is ALWAYS truthy whether or not anybody has signed in.
 * clientAuth overwrites it with the Client document, which is why the client
 * panel behaves and why the trap is invisible from that side: a bare
 * `if (req.client)` reads as "is this a client" and answers yes on a leader's
 * request, an employee's and an administrator's.
 *
 * That is not hypothetical. utils/activity.js used the plain test to decide
 * whether to store an actor id, so every audit entry written through
 * logActivity — thousands of them — recorded a name and no id, and the trail
 * could not be filtered by person or followed through a rename. The login
 * events looked fine only because their controllers write the id directly.
 *
 * So the question is asked positively, by what the document actually is.
 * `actorOf` above gets away with the plain reference only because it is last
 * in an || chain that every real panel matches first, and even there it now
 * goes through this.
 */
export const clientOf = (req) =>
  req.client && req.client.constructor?.modelName === "Client" ? req.client : null;

export default actorOf;
