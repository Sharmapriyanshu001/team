import ChatPanel from "../../../shared/components/ChatPanel";
import employeeApi from "../../employeeApi";
import { readStoredUser } from "../../../shared/createApi";

export default function ClientChat() {
  return (
    <ChatPanel
      api={employeeApi}
      base="/employee"
      tab="client"
      title="Client Chat"
      subtitle="Clients on your projects — enabled by the admin"
      currentUserId={readStoredUser("employee")?.id}
    />
  );
}
