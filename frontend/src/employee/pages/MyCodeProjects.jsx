import employeeApi from "../employeeApi";
import MyCodeProjectsBoard from "../../shared/components/MyCodeProjects";

export default function MyCodeProjects() {
  return (
    <MyCodeProjectsBoard
      api={employeeApi}
      base="/employee"
      workspaceBase="/employee/code-projects"
      subtitle="Code projects the admin has assigned to you — open them here, no download needed"
    />
  );
}
