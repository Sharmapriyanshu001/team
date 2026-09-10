import LeavesPage from "../../shared/hr/LeavesPage";
import hrApi from "../hrApi";
import useHrAccess from "../hooks/useHrAccess";
import useStaffOptions from "../hooks/useStaffOptions";

// The same screen the admin panel shows, against HR's own routes.
export default function Leave() {
  const { can } = useHrAccess();
  const { staffOptions } = useStaffOptions();

  return <LeavesPage api={hrApi} basePath="/hr" can={can} staffOptions={staffOptions} />;
}
