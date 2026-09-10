import { useCallback, useEffect, useState } from "react";

import salesApi from "../salesApi";

/**
 * How much work has landed on this sales account since they last looked.
 *
 * Drives the red dot beside Tasks in the sidebar. The count is kept in one
 * module-level value with subscribers rather than one per component, because
 * two components need it and they must not disagree: the sidebar shows the
 * dot, and the Tasks screen clears it. Held apart, opening the list would put
 * the dot out only when the sidebar's own poll next came round — up to a
 * minute of a panel insisting there is new work on a screen already showing it.
 *
 * A failed poll leaves the last known figure alone. A dot that blinks off on a
 * dropped request reads as "nothing waiting", which is the one thing it must
 * not say wrongly.
 */

let count = 0;
const listeners = new Set();

const publish = (value) => {
  count = value;
  listeners.forEach((fn) => fn(value));
};

export default function useNewTasks() {
  const [newTasks, setNewTasks] = useState(count);

  useEffect(() => {
    listeners.add(setNewTasks);
    return () => {
      listeners.delete(setNewTasks);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data } = await salesApi.get("/sales/tasks/new-count");
      publish(data.count || 0);
    } catch {
      // Keep the last known figure
    }
  }, []);

  /**
   * Called when the task list is opened. The dot goes out at once and the
   * server is told afterwards — the request only records what the person has
   * already seen with their own eyes, so nothing is lost if it fails.
   */
  const markSeen = useCallback(() => {
    publish(0);
    salesApi.put("/sales/tasks/seen").catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    // Work can land while the panel sits open, so keep asking
    const timer = setInterval(refresh, 60000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { newTasks, refresh, markSeen };
}
