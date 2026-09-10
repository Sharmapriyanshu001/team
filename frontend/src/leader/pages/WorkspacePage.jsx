import leaderApi from "../leaderApi";
import Workspace from "../../shared/workspace/Workspace";

export default function WorkspacePage() {
  return <Workspace api={leaderApi} base="/leader" backTo="/operation-manager/code-projects" />;
}
