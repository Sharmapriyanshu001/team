import { Navigate } from "react-router-dom";

// Guards the employee pages: no employee token -> back to the employee login.
export default function EmployeeRoute({ children }) {
  const token = localStorage.getItem("employeeToken");
  return token ? children : <Navigate to="/employee/login" replace />;
}
