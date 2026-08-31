import { createApi } from "../shared/createApi";

const employeeApi = createApi({
  tokenKey: "employeeToken",
  userKey: "employee",
  loginPath: "/employee/login",
});

export default employeeApi;
