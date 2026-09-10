import { useCallback, useEffect, useState } from "react";
import employeeApi from "./employeeApi";
import useLiveNotifications from "../shared/hooks/useLiveNotifications";
import { readStoredUser } from "../shared/createApi";
import { EmployeeContext } from "./employeeContext";

/**
 * Session-wide state for the employee panel: who is signed in, which optional
 * features the admin has enabled, and the unread notification count.
 */
export default function EmployeeProvider({ children }) {
  const [employee, setEmployee] = useState(() => readStoredUser("employee"));
  const [flags, setFlags] = useState({ clientChatEnabled: false });
  const [unread, setUnread] = useState(0);
  const [newTasks, setNewTasks] = useState(0);

  useEffect(() => {
    let active = true;

    employeeApi
      .get("/employee/me")
      .then(({ data }) => {
        if (!active) return;
        setEmployee(data.employee);
        setFlags(data.flags || { clientChatEnabled: false });
        localStorage.setItem("employee", JSON.stringify(data.employee));
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const refreshUnread = useCallback(() => {
    employeeApi
      .get("/employee/notifications", { params: { filter: "unread" } })
      .then(({ data }) => setUnread(data.unread || 0))
      .catch(() => setUnread(0));
  }, []);

  useEffect(() => {
    refreshUnread();
  }, [refreshUnread]);

  /**
   * A notification pushed to this account updates the badge at once, so
   * nobody has to reload a page to find out something happened to them.
   */
  useLiveNotifications("/employee", refreshUnread);

  /* ----------------------------------------------- the "new work" red dot */

  const refreshNewTasks = useCallback(() => {
    employeeApi
      .get("/employee/tasks/new-count")
      .then(({ data }) => setNewTasks(data.count || 0))
      .catch(() => {});
  }, []);

  // Clears the dot the moment the employee opens their task list
  const markTasksSeen = useCallback(() => {
    setNewTasks(0);
    employeeApi.put("/employee/tasks/seen").catch(() => {});
  }, []);

  // Work can land while the panel is open, so keep asking
  useEffect(() => {
    refreshNewTasks();
    const timer = setInterval(refreshNewTasks, 60000);
    return () => clearInterval(timer);
  }, [refreshNewTasks]);

  return (
    <EmployeeContext.Provider
      value={{
        employee,
        setEmployee,
        flags,
        unread,
        refreshUnread,
        newTasks,
        refreshNewTasks,
        markTasksSeen,
      }}
    >
      {children}
    </EmployeeContext.Provider>
  );
}
