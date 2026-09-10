import LeaveBalancesPage from "../../shared/hr/LeaveBalancesPage";
import hrApi from "../hrApi";

// The same screen the admin panel shows, against HR's own routes.
export default function LeaveBalances() {
  return <LeaveBalancesPage api={hrApi} basePath="/hr" />;
}
