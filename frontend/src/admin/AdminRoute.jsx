import { Navigate } from "react-router-dom";

// Guards the admin pages: no admin token -> back to the admin login.
export default function AdminRoute({ children }) {
  const token = localStorage.getItem("adminToken");
  return token ? children : <Navigate to="/admin/login" replace />;
}
