import { useCallback, useEffect, useState } from "react";

import hrApi from "../hrApi";
import useLiveNotifications from "../../shared/hooks/useLiveNotifications";

/**
 * How many notifications are waiting for this HR account.
 *
 * The leader, employee and client panels keep this in their context provider,
 * because they each have one. The HR panel does not, so it lives in a hook —
 * the same shape the admin panel uses, with a `refresh` the inbox calls after
 * marking things read so the bell catches up without a page reload.
 *
 * A failed poll is left alone rather than zeroed: a badge that blinks off on a
 * dropped request reads as "nothing waiting", which is the one thing it must
 * not say wrongly — particularly here, where what is waiting is somebody's
 * leave request.
 */
export default function useUnread() {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const { data } = await hrApi.get("/hr/notifications", {
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
  useLiveNotifications("/hr", refresh);

  return { unread, refresh };
}
