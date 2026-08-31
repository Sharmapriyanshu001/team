import ChatPanel from "../../../shared/components/ChatPanel";
import leaderApi from "../../leaderApi";
import { readStoredUser } from "../../../shared/createApi";

export default function ClientChat() {
  return (
    <ChatPanel
      api={leaderApi}
      base="/leader"
      tab="client"
      title="Client Chat"
      subtitle="Clients on your projects — enabled by the admin"
      currentUserId={readStoredUser("leader")?.id}
    />
  );
}
