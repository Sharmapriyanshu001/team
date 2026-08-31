import NotificationsPanel from "../../shared/components/NotificationsPanel";
import leaderApi from "../leaderApi";
import { useLeader } from "../leaderContext";

export default function Notifications() {
  const { refreshUnread } = useLeader();

  return <NotificationsPanel api={leaderApi} base="/leader" onRead={refreshUnread} />;
}
