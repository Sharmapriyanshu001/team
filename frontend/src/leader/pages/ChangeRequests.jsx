import ChangeRequestsPage from "../../shared/delivery/ChangeRequestsPage";
import leaderApi from "../leaderApi";

/**
 * Client changes on the projects this manager runs.
 *
 * The extra thing this panel can do is decide: handing a request to somebody
 * on the project, and declining one with a reason the client will read. The
 * buttons for both come from the server's `can` on each row rather than from
 * anything passed in here.
 */
export default function ChangeRequests() {
  return (
    <ChangeRequestsPage
      api={leaderApi}
      basePath="/leader"
      title="Client changes"
      subtitle="What your clients asked for, who is carrying it, and where it stands"
    />
  );
}
