import DepartmentsPage from "../../shared/reporting/DepartmentsPage";
import hrApi from "../hrApi";
import useHrAccess from "../hooks/useHrAccess";

/**
 * Sales and Operations side by side, as HR sees them.
 *
 * HR leads the department managers, so the gaps matter here more than
 * anywhere: a team with no manager is HR's to staff. And opening a new
 * department is HR's too — it used to need an administrator, which meant the
 * department had to exist before the people who staff it could say so.
 */
export default function Departments() {
  const { can } = useHrAccess();

  return (
    <DepartmentsPage
      api={hrApi}
      basePath="/hr/reports"
      title="Departments"
      subtitle="The managers you lead, their teams and their numbers"
      // Left out for an account without the grant, so the panel does not offer
      // a button the server will refuse.
      managePath={can("departments", "create") ? "/hr/departments" : undefined}
    />
  );
}
