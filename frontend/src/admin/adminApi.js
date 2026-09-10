import { createApi } from "../shared/createApi";

const adminApi = createApi({
  tokenKey: "adminToken",
  userKey: "admin",
  loginPath: "/",
  logoutPath: "/admin/logout",
});

export default adminApi;
