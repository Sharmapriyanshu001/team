import { Navigate } from "react-router-dom";

// Guards the leader pages: no leader token -> back to the leader login.
export default function LeaderRoute({ children }) {
  const token = localStorage.getItem("leaderToken");
  return token ? children : <Navigate to="/team-leader/login" replace />;
}
