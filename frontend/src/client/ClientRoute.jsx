import { Navigate } from "react-router-dom";

// Guards the client pages: no token -> back to the one login at "/".
export default function ClientRoute({ children }) {
  const token = localStorage.getItem("clientToken");
  return token ? children : <Navigate to="/" replace />;
}
