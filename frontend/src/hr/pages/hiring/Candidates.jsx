import RecruitmentPage from "../../../shared/hr/RecruitmentPage";
import hrApi from "../../hrApi";
import useHrAccess from "../../hooks/useHrAccess";
import useHiringLookups from "../../hooks/useHiringLookups";

/**
 * Everybody in the pipeline, as a list — where candidates are actually worked
 * on, as opposed to the board, which is where the pipeline is read.
 *
 * The screen is shared with the admin panel's Recruitment page. What Hiring
 * adds is the vacancy each application is against, and the two decisions that
 * move somebody along: advance a stage, or stop here.
 *
 * `canHireDepartmentRoles` is false and stays false — hiring somebody into a
 * department role creates a department login, and the server allows that only
 * for a full administrator.
 */
export default function Candidates() {
  const { can } = useHrAccess();
  const { staffOptions, openingOptions } = useHiringLookups();

  return (
    <RecruitmentPage
      api={hrApi}
      basePath="/hr"
      can={can}
      staffOptions={staffOptions}
      openingOptions={openingOptions}
      stagePath="/hr/hiring/candidates"
      canHireDepartmentRoles={false}
      title="Candidates"
      subtitle="Everybody in the hiring pipeline"
    />
  );
}
