import ChangeRequestsPage from "../../../shared/delivery/ChangeRequestsPage";
import adminApi from "../../adminApi";

/**
 * Every client change request in the company, with its whole history.
 *
 * The monitoring view: no scope filter is applied for an administrator, so
 * this is the screen that answers "what has been asked of us and what happened
 * to it" across every project at once.
 */
export default function ChangeRequests() {
  return (
    <ChangeRequestsPage
      api={adminApi}
      basePath="/admin"
      title="Change requests"
      subtitle="Everything clients have asked to be changed, across every project"
    />
  );
}
