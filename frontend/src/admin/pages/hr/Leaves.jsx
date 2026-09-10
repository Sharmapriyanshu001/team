import LeavesPage from "../../../shared/hr/LeavesPage";
import adminApi from "../../adminApi";
import useLookups from "../../hooks/useLookups";
import usePermissions from "../../hooks/usePermissions";

/**
 * The admin panel's view of leave.
 *
 * The screen itself is shared with the HR panel — one set of records with one
 * set of rules, so two implementations would be two things to keep in step and
 * one of them quietly wrong. What differs is only which api it speaks to and
 * whose permissions it asks.
 */
export default function Leaves() {
  const { staffOptions } = useLookups();
  const { can } = usePermissions();

  return (
    <LeavesPage api={adminApi} basePath="/admin/hr" can={can} staffOptions={staffOptions} />
  );
}
