import ChatPanel from "../../../shared/components/ChatPanel";
import employeeApi from "../../employeeApi";
import { readStoredUser } from "../../../shared/createApi";

export default function AdminChat() {
  return (
    <ChatPanel
      api={employeeApi}
      base="/employee"
      tab="admin"
      title="Admin Chat"
      subtitle="Messages with the administrator"
      currentUserId={readStoredUser("employee")?.id}
    />
  );
}
