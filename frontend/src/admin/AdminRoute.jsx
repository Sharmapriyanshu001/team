import { Navigate } from "react-router-dom";

// Guards the admin pages: no token -> back to the one login at "/".
export default function AdminRoute({ children }) {
  const token = localStorage.getItem("adminToken");
  return token ? children : <Navigate to="/" replace />;
}
