import MyTeam from "../../shared/team/MyTeam";
import employeeApi from "../employeeApi";

export default function MyTeamPage() {
  return <MyTeam api={employeeApi} base="/employee" />;
}
