import { createApi } from "../shared/createApi";

const clientApi = createApi({
  tokenKey: "clientToken",
  userKey: "client",
  loginPath: "/client/login",
});

export default clientApi;
