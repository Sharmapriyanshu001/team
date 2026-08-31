import NotificationsPanel from "../../shared/components/NotificationsPanel";
import clientApi from "../clientApi";
import { useClient } from "../clientContext";

export default function Notifications() {
  const { refreshUnread } = useClient();

  return <NotificationsPanel api={clientApi} base="/client" onRead={refreshUnread} />;
}
