import { Navigate } from "react-router-dom";

// Guards the employee pages: no token -> back to the one login at "/".
export default function EmployeeRoute({ children }) {
  const token = localStorage.getItem("employeeToken");
  return token ? children : <Navigate to="/" replace />;
}
