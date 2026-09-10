import MyPlayWork from "../../shared/play/MyPlayWork";
import leaderApi from "../leaderApi";

export default function PlayApps() {
  return <MyPlayWork api={leaderApi} base="/leader" appPath="/operation-manager/play" />;
}
