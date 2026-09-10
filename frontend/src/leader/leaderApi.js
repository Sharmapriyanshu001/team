import { createApi } from "../shared/createApi";

const leaderApi = createApi({
  tokenKey: "leaderToken",
  userKey: "leader",
  loginPath: "/",
  logoutPath: "/leader/logout",
});

export default leaderApi;
