import { createApi } from "../shared/createApi";

const adminApi = createApi({
  tokenKey: "adminToken",
  userKey: "admin",
  loginPath: "/admin/login",
});

export default adminApi;
