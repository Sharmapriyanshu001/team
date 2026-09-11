import DepartmentsPage from "../../shared/reporting/DepartmentsPage";
import hrApi from "../hrApi";

/**
 * Sales and Operations side by side, as HR sees them.
 *
 * HR leads the department managers, so the gaps matter here more than
 * anywhere: a team with no manager is HR's to staff.
 *
 * Read-only, like the admin panel's copy of this screen. `managePath` is what
 * puts an "Add department" button on it, and neither panel passes one now — a
 * department is a Team with a kind on it, and Teams & Targets is where one is
 * opened. Two doors onto the same record, one of which explained less about
 * what it was creating, was the thing worth removing.
 */
export default function Departments() {
  return (
    <DepartmentsPage
      api={hrApi}
      basePath="/hr/reports"
      title="Departments"
      subtitle="The managers you lead, their teams and who answers to whom"
    />
  );
}
