import NotificationsPanel from "../../shared/components/NotificationsPanel";
import adminApi from "../adminApi";
import useUnread from "../hooks/useUnread";

/**
 * The admin's inbox — the same component the other three panels use.
 *
 * What lands here was already being written: a client sending a message or
 * asking for a meeting, an employee submitting code for review, a team leader
 * writing in, a delete or edit request, a project going to the bin. None of it
 * had anywhere to be read until this page existed.
 */
export default function Notifications() {
  const { refresh } = useUnread();

  return <NotificationsPanel api={adminApi} base="/admin" onRead={refresh} />;
}
