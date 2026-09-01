import MyAdsWork from "../../shared/ads/MyAdsWork";
import employeeApi from "../employeeApi";

export default function AdsWork() {
  return <MyAdsWork api={employeeApi} base="/employee" accountPath="/employee/ads" />;
}
