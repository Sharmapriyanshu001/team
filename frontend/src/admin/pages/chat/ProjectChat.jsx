import ChatPanel from "../../../shared/components/ChatPanel";
import adminApi from "../../adminApi";
import { readStoredUser } from "../../../shared/createApi";

export default function ProjectChat() {
  return (
    <ChatPanel
      api={adminApi}
      base="/admin"
      tab="project"
      title="Project Chats"
      subtitle="One thread per project, visible to everyone assigned"
      currentUserId={readStoredUser("admin")?.id}
    />
  );
}
