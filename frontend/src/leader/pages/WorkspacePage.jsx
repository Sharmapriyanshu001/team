import leaderApi from "../leaderApi";
import Workspace from "../../shared/workspace/Workspace";

export default function WorkspacePage() {
  return <Workspace api={leaderApi} base="/leader" backTo="/team-leader/code-projects" />;
}
