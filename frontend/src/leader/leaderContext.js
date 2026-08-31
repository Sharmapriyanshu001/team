import { createContext, useContext } from "react";

export const LeaderContext = createContext(null);

/** Session state for the leader panel — see LeaderProvider. */
export const useLeader = () => useContext(LeaderContext);
