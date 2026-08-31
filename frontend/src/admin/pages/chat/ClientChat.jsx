import ChatPanel from "../../../shared/components/ChatPanel";
import adminApi from "../../adminApi";
import { readStoredUser } from "../../../shared/createApi";

export default function ClientChat() {
  return (
    <ChatPanel
      api={adminApi}
      base="/admin"
      tab="client"
      title="Client Chat"
      subtitle="Conversations with each client"
      currentUserId={readStoredUser("admin")?.id}
    />
  );
}
