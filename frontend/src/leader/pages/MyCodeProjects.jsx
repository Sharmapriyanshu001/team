import leaderApi from "../leaderApi";
import MyCodeProjectsBoard from "../../shared/components/MyCodeProjects";

/**
 * Leading a business project grants nothing here — only being named on the
 * code project itself does, which the server decides on every request.
 */
export default function MyCodeProjects() {
  return (
    <MyCodeProjectsBoard
      api={leaderApi}
      base="/leader"
      workspaceBase="/operation-manager/code-projects"
      subtitle="Code projects the admin has assigned to you — open them here, no download needed"
    />
  );
}
