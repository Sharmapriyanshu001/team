import adminApi from "../../adminApi";
import Workspace from "../../../shared/workspace/Workspace";

export default function WorkspacePage() {
  return <Workspace api={adminApi} base="/admin" backTo="/admin/code-projects" />;
}
