import { Navigate } from "react-router-dom";

// Guards the Sales pages: no token -> back to the one login at "/".
export default function SalesRoute({ children }) {
  const token = localStorage.getItem("salesToken");
  return token ? children : <Navigate to="/" replace />;
}
