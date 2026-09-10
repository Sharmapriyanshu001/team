import RecruitmentPage from "../../../shared/hr/RecruitmentPage";
import adminApi from "../../adminApi";
import useLookups from "../../hooks/useLookups";
import usePermissions from "../../hooks/usePermissions";

// Shared with the HR panel — see Leaves.jsx for why.
export default function Recruitment() {
  const { staffOptions } = useLookups();
  const { can, isFullAdmin } = usePermissions();

  return (
    <RecruitmentPage
      api={adminApi}
      basePath="/admin/hr"
      can={can}
      staffOptions={staffOptions}
      // Hiring into a department role creates a department login, which the
      // server allows only for a full administrator
      canHireDepartmentRoles={isFullAdmin}
    />
  );
}
