import ReportingPage from "../../shared/reporting/ReportingPage";
import adminApi from "../adminApi";

/**
 * The top of the chain.
 *
 * HR sends the company report here; the administrator answers it, and can
 * follow any figure down through the team update to the individual week that
 * produced it.
 */
export default function ReportChain() {
  return (
    <ReportingPage
      api={adminApi}
      basePath="/admin/reports/chain"
      title="Report Chain"
      subtitle="HR reports to you — Team Member → Manager → HR → Admin"
    />
  );
}
