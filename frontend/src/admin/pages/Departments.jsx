import DepartmentsPage from "../../shared/reporting/DepartmentsPage";
import adminApi from "../adminApi";

/**
 * Every department, its teams, its managers and its numbers — and the places
 * where the reporting chain is broken.
 */
export default function Departments() {
  return (
    <DepartmentsPage
      api={adminApi}
      basePath="/admin/reports/chain"
      title="Departments"
      subtitle="Sales and Operations, their managers and the chain that reports to you"
    />
  );
}
