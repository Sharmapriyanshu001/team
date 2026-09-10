import ReportingPage from "../../shared/reporting/ReportingPage";
import hrApi from "../hrApi";

/**
 * HR's place in the company's reporting chain.
 *
 * Managers send their team updates up to HR; HR answers them and sends the
 * company report on to the Admin. The screen is shared by all four panels —
 * the server decides what each level writes and who it goes to, so a person's
 * place in the hierarchy is never hard-coded into a page.
 *
 * Distinct from Reports, which is HR's own analytics.
 */
export default function ReportChain() {
  return (
    <ReportingPage
      api={hrApi}
      basePath="/hr/reports"
      title="Report Chain"
      subtitle="Managers report to you; you report to the Admin"
    />
  );
}
