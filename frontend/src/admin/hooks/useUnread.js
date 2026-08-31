import { useCallback, useEffect, useState } from "react";
import adminApi from "../adminApi";

/**
 * How many notifications are waiting for this admin.
 *
 * The other panels keep this in their context provider, because they each have
 * one. The admin panel does not, so it lives in a hook — same job, same minute
 * of polling, and a `refresh` the inbox calls after marking things read so the
 * bell catches up without a page reload.
 *
 * A failed poll is left alone rather than zeroed: a badge that blinks off on a
 * dropped request reads as "nothing waiting", which is the one thing it must
 * not say wrongly.
 */
export default function useUnread() {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const { data } = await adminApi.get("/admin/notifications", {
        params: { filter: "unread" },
      });
      setUnread(data.unread || 0);
    } catch {
      // Keep the last known figure
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { unread, refresh };
}
