import LeavePoliciesPage from "../../../shared/hr/LeavePoliciesPage";
import adminApi from "../../adminApi";
import usePermissions from "../../hooks/usePermissions";

// Shared with the HR panel — see Leaves.jsx for why.
export default function LeavePolicies() {
  const { can } = usePermissions();
  return <LeavePoliciesPage api={adminApi} basePath="/admin/hr" can={can} />;
}
