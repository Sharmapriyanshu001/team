import ChatPanel from "../../../shared/components/ChatPanel";
import adminApi from "../../adminApi";
import { readStoredUser } from "../../../shared/createApi";

export default function EmployeeChat() {
  return (
    <ChatPanel
      api={adminApi}
      base="/admin"
      tab="employee_admin"
      title="Employee Chat"
      subtitle="Direct messages with team members"
      currentUserId={readStoredUser("admin")?.id}
    />
  );
}
