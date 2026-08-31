import ChatPanel from "../../../shared/components/ChatPanel";
import leaderApi from "../../leaderApi";
import { readStoredUser } from "../../../shared/createApi";

export default function AdminChat() {
  return (
    <ChatPanel
      api={leaderApi}
      base="/leader"
      tab="admin"
      title="Admin Chat"
      subtitle="Your direct line to the administrator"
      currentUserId={readStoredUser("leader")?.id}
    />
  );
}
