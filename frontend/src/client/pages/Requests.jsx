import ChangeRequestsPage from "../../shared/delivery/ChangeRequestsPage";
import clientApi from "../clientApi";
import useLookups from "../hooks/useLookups";

/**
 * The client's own change requests.
 *
 * The same screen the team reads, from the other end — see
 * shared/delivery/ChangeRequestsPage.jsx. What differs is what the server
 * allows, not what this file passes in: a client can raise one and add to the
 * thread, and cannot set a progress figure or turn one down.
 */
export default function Requests() {
  const { projects } = useLookups();

  return (
    <ChangeRequestsPage
      api={clientApi}
      basePath="/client"
      title="Change requests"
      subtitle="Ask for a change, and follow exactly what happens to it"
      projects={projects || []}
    />
  );
}
