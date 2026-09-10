import ChatPanel from "../../../shared/components/ChatPanel";
import adminApi from "../../adminApi";
import { readStoredUser } from "../../../shared/createApi";

export default function OperationsManagerChat() {
  return (
    <ChatPanel
      api={adminApi}
      base="/admin"
      tab="operations_manager"
      title="Operations Manager Chat"
      subtitle="Direct messages with your project leads"
      currentUserId={readStoredUser("admin")?.id}
    />
  );
}
