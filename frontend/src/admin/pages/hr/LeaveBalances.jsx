import LeaveBalancesPage from "../../../shared/hr/LeaveBalancesPage";
import adminApi from "../../adminApi";

// Shared with the HR panel — see Leaves.jsx for why.
export default function LeaveBalances() {
  return <LeaveBalancesPage api={adminApi} basePath="/admin/hr" />;
}
