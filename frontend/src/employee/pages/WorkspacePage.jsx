import employeeApi from "../employeeApi";
import Workspace from "../../shared/workspace/Workspace";

export default function WorkspacePage() {
  return <Workspace api={employeeApi} base="/employee" backTo="/employee/code-projects" />;
}
