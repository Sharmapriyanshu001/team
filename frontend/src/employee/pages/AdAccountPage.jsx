import MyAdAccount from "../../shared/ads/MyAdAccount";
import employeeApi from "../employeeApi";

export default function AdAccountPage() {
  return <MyAdAccount api={employeeApi} base="/employee" homePath="/employee/ads" />;
}
