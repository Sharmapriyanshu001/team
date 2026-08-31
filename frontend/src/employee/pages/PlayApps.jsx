import MyPlayWork from "../../shared/play/MyPlayWork";
import employeeApi from "../employeeApi";

export default function PlayApps() {
  return <MyPlayWork api={employeeApi} base="/employee" appPath="/employee/play" />;
}
