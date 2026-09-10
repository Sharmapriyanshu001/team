import NotificationsPanel from "../../shared/components/NotificationsPanel";
import hrApi from "../hrApi";
import useUnread from "../hooks/useUnread";

/**
 * HR's inbox — the same component the other four panels use.
 *
 * What lands here was already being written and read by nobody: an employee
 * applying for leave notifies every active HR account, withdrawing one does
 * the same, and hiring writes here too. Until this page existed those rows
 * were created and then sat unread, so a leave request arrived and the person
 * who had to decide it was never told.
 */
export default function Notifications() {
  const { refresh } = useUnread();

  return <NotificationsPanel api={hrApi} base="/hr" onRead={refresh} />;
}
