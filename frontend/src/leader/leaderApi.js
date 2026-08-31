import { createApi } from "../shared/createApi";

const leaderApi = createApi({
  tokenKey: "leaderToken",
  userKey: "leader",
  loginPath: "/team-leader/login",
  logoutPath: "/leader/logout",
});

export default leaderApi;
