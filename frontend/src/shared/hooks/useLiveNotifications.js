import { useEffect, useRef } from "react";

import { getSocket } from "../realtime";

/**
 * Notifications that arrive on their own.
 *
 * Every panel already polled its unread count once a minute, which meant a
 * leave request could sit for the better part of a minute before the person
 * who had to act on it saw anything — and an inbox left open never changed at
 * all until somebody reloaded the page.
 *
 * The socket was already there and every connection already joins its own
 * `user:<id>` channel, so this is a listener rather than new plumbing. The
 * poll stays as the safety net: a dropped socket, a sleeping laptop or a
 * missed reconnect means the count is a minute stale rather than wrong for
 * the rest of the session.
 *
 * Which panel's connection to use is decided by the API prefix the caller is
 * already passing, so no screen has to learn a second name for itself.
 */
const TOKEN_KEYS = {
  "/admin": "adminToken",
  "/hr": "hrToken",
  "/leader": "leaderToken",
  "/employee": "employeeToken",
  "/client": "clientToken",
};

export const tokenKeyForBase = (base) => TOKEN_KEYS[base] || null;

/**
 * Call `onNotification` whenever one is pushed to this account.
 *
 * The callback is held in a ref so a caller passing an inline arrow does not
 * tear the subscription down and build it again on every render — which would
 * drop notifications arriving in the gap.
 */
export default function useLiveNotifications(base, onNotification) {
  const handler = useRef(onNotification);
  handler.current = onNotification;

  useEffect(() => {
    const tokenKey = tokenKeyForBase(base);
    if (!tokenKey) return undefined;

    const socket = getSocket(tokenKey);
    if (!socket) return undefined;

    const listener = (payload) => handler.current?.(payload);
    socket.on("notification:new", listener);

    /**
     * A reconnect means the gap was long enough for the server to have given
     * up on this socket, so anything sent during it is gone. Ask the caller to
     * refetch rather than leaving a silently stale inbox behind.
     */
    const onReconnect = () => handler.current?.({ reconnected: true });
    socket.on("connect", onReconnect);

    return () => {
      socket.off("notification:new", listener);
      socket.off("connect", onReconnect);
    };
  }, [base]);
}
