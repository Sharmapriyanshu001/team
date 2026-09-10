import MyAdAccount from "../../shared/ads/MyAdAccount";
import leaderApi from "../leaderApi";

export default function AdAccountPage() {
  return <MyAdAccount api={leaderApi} base="/leader" homePath="/operation-manager/ads" />;
}
