import adminApi from "../../adminApi";
import CodeShareBoard from "../../../shared/components/CodeShareBoard";

/**
 * The admin's own send/receive desk. Separate from Code Review, which is the
 * approval pipeline for what employees submit — this is a straight hand-over.
 */
export default function CodeShare() {
  return (
    <CodeShareBoard
      api={adminApi}
      base="/admin"
      subtitle="Send a code archive to anyone on the team, and pick up what they send you"
    />
  );
}
