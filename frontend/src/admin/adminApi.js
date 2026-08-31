import { createApi } from "../shared/createApi";

const adminApi = createApi({
  tokenKey: "adminToken",
  userKey: "admin",
  loginPath: "/admin/login",
  logoutPath: "/admin/logout",
});

export default adminApi;
