import { createApi } from "../shared/createApi";

/**
 * The Sales panel's own session.
 *
 * A key of its own, like every other panel, so an admin and a sales account
 * can be signed in side by side in the same browser without one clobbering
 * the other — and so signing out of one leaves the other alone.
 */
const salesApi = createApi({
  tokenKey: "salesToken",
  userKey: "sales",
  loginPath: "/",
  logoutPath: "/sales/logout",
});

export default salesApi;
