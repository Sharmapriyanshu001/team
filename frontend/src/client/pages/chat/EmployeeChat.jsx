import ChatPanel from "../../../shared/components/ChatPanel";
import clientApi from "../../clientApi";

export default function EmployeeChat() {
  return (
    <ChatPanel
      api={clientApi}
      base="/client"
      tab="employees"
      title="Project Team Chat"
      subtitle="Message the team working on your projects"
      // Staff messages carry a sender id; a client's never does
      mineWhen={(message) => !message.sender}
    />
  );
}
