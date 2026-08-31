import ChatPanel from "../../../shared/components/ChatPanel";
import leaderApi from "../../leaderApi";
import { readStoredUser } from "../../../shared/createApi";

export default function EmployeeChat() {
  return (
    <ChatPanel
      api={leaderApi}
      base="/leader"
      tab="employee"
      title="Employee Chat"
      subtitle="Message anyone reporting to you"
      currentUserId={readStoredUser("leader")?.id}
    />
  );
}
