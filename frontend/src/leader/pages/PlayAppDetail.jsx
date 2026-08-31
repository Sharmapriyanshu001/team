import MyAppDetail from "../../shared/play/MyAppDetail";
import leaderApi from "../leaderApi";

export default function PlayAppDetail() {
  return <MyAppDetail api={leaderApi} base="/leader" homePath="/team-leader/play" />;
}
