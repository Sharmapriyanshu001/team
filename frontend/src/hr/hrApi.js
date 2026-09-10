import { createApi } from "../shared/createApi";

/**
 * The HR panel's own session.
 *
 * A key of its own, like every other panel, so an admin and an HR account can
 * be signed in side by side in the same browser without one clobbering the
 * other — and so signing out of one leaves the other alone.
 */
const hrApi = createApi({
  tokenKey: "hrToken",
  userKey: "hr",
  loginPath: "/",
  logoutPath: "/hr/logout",
});

export default hrApi;
