import NotificationsPanel from "../../shared/components/NotificationsPanel";
import salesApi from "../salesApi";
import useUnread from "../hooks/useUnread";

/**
 * The Sales inbox — the same component the other four panels use.
 *
 * What lands here is work being handed to you: a lead assigned, a follow-up
 * passed on, a deal closed by somebody else on the floor. It updates live, so
 * a lead handed over mid-morning appears without a reload.
 */
export default function Notifications() {
  const { refresh } = useUnread();

  return <NotificationsPanel api={salesApi} base="/sales" onRead={refresh} />;
}
