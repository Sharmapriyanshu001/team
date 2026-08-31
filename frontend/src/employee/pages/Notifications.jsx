import NotificationsPanel from "../../shared/components/NotificationsPanel";
import employeeApi from "../employeeApi";
import { useEmployee } from "../employeeContext";

export default function Notifications() {
  const { refreshUnread } = useEmployee();

  return <NotificationsPanel api={employeeApi} base="/employee" onRead={refreshUnread} />;
}
