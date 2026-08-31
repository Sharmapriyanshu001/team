import ChatPanel from "../../../shared/components/ChatPanel";
import employeeApi from "../../employeeApi";
import { readStoredUser } from "../../../shared/createApi";

export default function LeaderChat() {
  return (
    <ChatPanel
      api={employeeApi}
      base="/employee"
      tab="team_leader"
      title="Team Leader Chat"
      subtitle="Your direct line to your team leader"
      currentUserId={readStoredUser("employee")?.id}
    />
  );
}
