import ReportingPage from "../../shared/reporting/ReportingPage";
import employeeApi from "../employeeApi";

/**
 * This panel's view of the company-wide reporting chain.
 *
 * The screen is shared by every panel — Team Member, Manager, HR and Admin all
 * do the same three things with it, and the server decides what each of them
 * writes and who it goes to. Four copies would be four places for the chain to
 * drift, and the drift would be silent.
 */
export default function Reporting() {
  return (
    <ReportingPage
      api={employeeApi}
      basePath="/employee/reports"
      title="My Reports"
      subtitle="Your update goes to your manager"
    />
  );
}
