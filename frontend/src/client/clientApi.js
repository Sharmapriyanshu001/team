import { createApi } from "../shared/createApi";

const clientApi = createApi({
  tokenKey: "clientToken",
  userKey: "client",
  loginPath: "/",
  logoutPath: "/client/logout",
});

export default clientApi;
