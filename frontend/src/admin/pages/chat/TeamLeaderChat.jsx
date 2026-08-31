import ChatPanel from "../../../shared/components/ChatPanel";
import adminApi from "../../adminApi";
import { readStoredUser } from "../../../shared/createApi";

export default function TeamLeaderChat() {
  return (
    <ChatPanel
      api={adminApi}
      base="/admin"
      tab="team_leader"
      title="Team Leader Chat"
      subtitle="Direct messages with your project leads"
      currentUserId={readStoredUser("admin")?.id}
    />
  );
}
