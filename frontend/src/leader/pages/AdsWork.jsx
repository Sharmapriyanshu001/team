import MyAdsWork from "../../shared/ads/MyAdsWork";
import leaderApi from "../leaderApi";

export default function AdsWork() {
  return <MyAdsWork api={leaderApi} base="/leader" accountPath="/team-leader/ads" />;
}
