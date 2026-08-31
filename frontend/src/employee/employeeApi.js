import { createApi } from "../shared/createApi";

const employeeApi = createApi({
  tokenKey: "employeeToken",
  userKey: "employee",
  loginPath: "/employee/login",
  logoutPath: "/employee/logout",
});

export default employeeApi;
