import ReportingPage from "../../shared/reporting/ReportingPage";
import leaderApi from "../leaderApi";

/**
 * A department manager's place in the company's reporting chain.
 *
 * The team's updates arrive here; the manager answers them and sends one team
 * update up to HR, naming the member updates it summarises so HR can open
 * them. The screen is shared by all four panels — the server decides what each
 * level writes and who it goes to.
 *
 * Distinct from Reports, which is this panel's own project analytics.
 */
export default function ReportChain() {
  return (
    <ReportingPage
      api={leaderApi}
      basePath="/leader/reports"
      title="Report Chain"
      subtitle="Your team reports to you; you report to HR"
    />
  );
}
