import AttendancePage from "../../../shared/hr/AttendancePage";
import adminApi from "../../adminApi";

/**
 * The admin panel's attendance sheet.
 *
 * The screen is shared with the HR panel — one sheet, one set of rules, so two
 * implementations would be two things to keep in step and one of them quietly
 * wrong. Only the api and the base path differ.
 */
export default function Attendance() {
  return <AttendancePage api={adminApi} basePath="/admin" />;
}
