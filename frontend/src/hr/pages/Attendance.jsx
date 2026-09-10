import AttendancePage from "../../shared/hr/AttendancePage";
import hrApi from "../hrApi";
import useHrAccess from "../hooks/useHrAccess";

// The same sheet the admin panel shows, against HR's own routes.
export default function Attendance() {
  const { can } = useHrAccess();
  return <AttendancePage api={hrApi} basePath="/hr" canEdit={can("attendance", "create")} />;
}
