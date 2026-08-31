import leaderApi from "../leaderApi";
import CodeShareBoard from "../../shared/components/CodeShareBoard";

export default function CodeShare() {
  return (
    <CodeShareBoard
      api={leaderApi}
      base="/leader"
      subtitle="Send a code archive to your team or the admin, and pick up what they send you"
    />
  );
}
