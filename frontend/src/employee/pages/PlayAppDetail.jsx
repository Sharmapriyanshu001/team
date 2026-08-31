import MyAppDetail from "../../shared/play/MyAppDetail";
import employeeApi from "../employeeApi";

export default function PlayAppDetail() {
  return <MyAppDetail api={employeeApi} base="/employee" homePath="/employee/play" />;
}
