import MyTeam from "../../shared/team/MyTeam";
import leaderApi from "../leaderApi";

export default function MyTeamPage() {
  return <MyTeam api={leaderApi} base="/leader" />;
}
