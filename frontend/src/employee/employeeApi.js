import { createApi } from "../shared/createApi";

const employeeApi = createApi({
  tokenKey: "employeeToken",
  userKey: "employee",
  loginPath: "/",
  logoutPath: "/employee/logout",
});

export default employeeApi;
