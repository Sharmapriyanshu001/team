import { Navigate } from "react-router-dom";

// Guards the operations manager pages: no token -> back to the one login at "/".
export default function LeaderRoute({ children }) {
  const token = localStorage.getItem("leaderToken");
  return token ? children : <Navigate to="/" replace />;
}
