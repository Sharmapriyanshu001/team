import { Navigate } from "react-router-dom";

// Guards the HR pages: no token -> back to the one login at "/".
export default function HrRoute({ children }) {
  const token = localStorage.getItem("hrToken");
  return token ? children : <Navigate to="/" replace />;
}
