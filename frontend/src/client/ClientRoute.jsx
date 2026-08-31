import { Navigate } from "react-router-dom";

// Guards the portal: no client token -> back to the client login.
export default function ClientRoute({ children }) {
  const token = localStorage.getItem("clientToken");
  return token ? children : <Navigate to="/client/login" replace />;
}
