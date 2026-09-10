import { createContext, useCallback, useContext, useEffect, useState } from "react";

import useLiveNotifications from "./useLiveNotifications";

/**
 * One unread count per panel, shared by everything that shows it.
 *
 * This started as a plain hook, which meant the layout and the inbox each
 * called it and each got a private count of their own. Marking everything read
 * refreshed the inbox's copy while the bell in the topbar went on rendering the
 * layout's, so the badge kept a number that was already wrong until its own
 * poll came round up to a minute later. One piece of state behind a provider is
 * what makes the two agree — and it leaves one poll and one socket listener
 * where the inbox used to double both.
 *
 * A failed poll is left alone rather than zeroed: a badge that blinks off on a
 * dropped request reads as "nothing waiting", which is the one thing it must
 * not say wrongly.
 */
export default function createUnreadContext(api, base) {
  const UnreadContext = createContext(null);

  function UnreadProvider({ children }) {
    const [unread, setUnread] = useState(0);

    const refresh = useCallback(async () => {
      try {
        const { data } = await api.get(`${base}/notifications`, {
          params: { filter: "unread" },
        });
        setUnread(data.unread || 0);
      } catch {
        // Keep the last known figure
      }
    }, []);

    useEffect(() => {
      refresh();
      // The poll stays as the safety net behind the live push below: a dropped
      // socket should leave the count a minute stale, never permanently wrong.
      const timer = setInterval(refresh, 60000);
      return () => clearInterval(timer);
    }, [refresh]);

    /** A notification pushed to this account updates the bell at once. */
    useLiveNotifications(base, refresh);

    return <UnreadContext.Provider value={{ unread, refresh }}>{children}</UnreadContext.Provider>;
  }

  /** The panel's unread count, and a `refresh` the inbox calls after marking things read. */
  const useUnread = () => {
    const value = useContext(UnreadContext);
    if (!value) {
      throw new Error(`useUnread for "${base}" was used outside its UnreadProvider`);
    }
    return value;
  };

  return { UnreadProvider, useUnread };
}
