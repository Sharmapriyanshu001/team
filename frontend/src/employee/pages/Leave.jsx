import LeavePage from "../../shared/leave/LeavePage";
import employeeApi from "../employeeApi";

/**
 * This panel's view of the shared leave screen.
 *
 * The screen is the same in every panel — ask, watch, withdraw — and the
 * server decides who the request reaches. Three copies would be three places
 * for the withdraw rule to drift.
 */
export default function EmployeeLeave() {
  return (
    <LeavePage
      api={employeeApi}
      base="/employee"
      title="My Leave"
      subtitle="Apply for time off and follow what HR decided"
    />
  );
}
