import { useCallback, useEffect, useState } from "react";
import leaderApi from "./leaderApi";
import { readStoredUser } from "../shared/createApi";
import { LeaderContext } from "./leaderContext";

/**
 * Session-wide state for the leader panel: who is signed in, which optional
 * features the admin has enabled, and the unread notification count that the
 * sidebar badge reads.
 */
export default function LeaderProvider({ children }) {
  const [leader, setLeader] = useState(() => readStoredUser("leader"));
  const [flags, setFlags] = useState({ clientChatEnabled: false });
  const [unread, setUnread] = useState(0);
  const [newTasks, setNewTasks] = useState(0);

  useEffect(() => {
    let active = true;

    leaderApi
      .get("/leader/me")
      .then(({ data }) => {
        if (!active) return;
        setLeader(data.leader);
        setFlags(data.flags || { clientChatEnabled: false });
        localStorage.setItem("leader", JSON.stringify(data.leader));
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const refreshUnread = useCallback(() => {
    leaderApi
      .get("/leader/notifications", { params: { filter: "unread" } })
      .then(({ data }) => setUnread(data.unread || 0))
      .catch(() => setUnread(0));
  }, []);

  // The badge only ever updates from the response, never synchronously here.
  useEffect(() => {
    refreshUnread();
  }, [refreshUnread]);

  /* ----------------------------------------------- the "new work" red dot */

  const refreshNewTasks = useCallback(() => {
    leaderApi
      .get("/leader/tasks/new-count")
      .then(({ data }) => setNewTasks(data.count || 0))
      .catch(() => {});
  }, []);

  // Clears the dot the moment the leader opens their task list
  const markTasksSeen = useCallback(() => {
    setNewTasks(0);
    leaderApi.put("/leader/tasks/seen").catch(() => {});
  }, []);

  // Work can land while the panel is open, so keep asking
  useEffect(() => {
    refreshNewTasks();
    const timer = setInterval(refreshNewTasks, 60000);
    return () => clearInterval(timer);
  }, [refreshNewTasks]);

  return (
    <LeaderContext.Provider
      value={{
        leader,
        setLeader,
        flags,
        unread,
        refreshUnread,
        newTasks,
        refreshNewTasks,
        markTasksSeen,
      }}
    >
      {children}
    </LeaderContext.Provider>
  );
}
