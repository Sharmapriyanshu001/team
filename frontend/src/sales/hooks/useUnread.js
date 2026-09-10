import { useCallback, useEffect, useState } from "react";

import salesApi from "../salesApi";
import useLiveNotifications from "../../shared/hooks/useLiveNotifications";

/**
 * How many notifications are waiting for this sales account.
 *
 * A failed poll is left alone rather than zeroed: a badge that blinks off on a
 * dropped request reads as "nothing waiting", which is the one thing it must
 * not say wrongly when what is waiting is a lead somebody just handed you.
 */
export default function useUnread() {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const { data } = await salesApi.get("/sales/notifications", {
        params: { filter: "unread" },
      });
      setUnread(data.unread || 0);
    } catch {
      // Keep the last known figure
    }
  }, []);

  useEffect(() => {
    refresh();
    // The poll is the safety net behind the live push below: a dropped socket
    // should leave the count a minute stale, never permanently wrong.
    const timer = setInterval(refresh, 60000);
    return () => clearInterval(timer);
  }, [refresh]);

  /** A notification pushed to this account updates the bell at once. */
  useLiveNotifications("/sales", refresh);

  return { unread, refresh };
}
