import ChatPanel from "../../../shared/components/ChatPanel";
import employeeApi from "../../employeeApi";
import { readStoredUser } from "../../../shared/createApi";

export default function LeaderChat() {
  return (
    <ChatPanel
      api={employeeApi}
      base="/employee"
      tab="operations_manager"
      title="Operations Manager Chat"
      subtitle="Your direct line to your operations manager"
      currentUserId={readStoredUser("employee")?.id}
    />
  );
}
