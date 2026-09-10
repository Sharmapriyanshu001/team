import ChangeRequestsPage from "../../shared/delivery/ChangeRequestsPage";
import employeeApi from "../employeeApi";

/**
 * Client changes on the projects this employee is on.
 *
 * No project list is passed: an employee cannot raise a request, because a
 * change request is by definition something a client asked for. Work the
 * company decided on is a task, and tasks have their own screen.
 */
export default function ChangeRequests() {
  return (
    <ChangeRequestsPage
      api={employeeApi}
      basePath="/employee"
      title="Client changes"
      subtitle="What clients asked for on your projects — and what you have done about it"
    />
  );
}
