import ChatPanel from "../../../shared/components/ChatPanel";
import clientApi from "../../clientApi";

export default function AdminChat() {
  return (
    <ChatPanel
      api={clientApi}
      base="/client"
      tab="admin"
      title="Admin Chat"
      subtitle="Your direct line to the JHA team"
      // Staff messages carry a sender id; a client's never does
      mineWhen={(message) => !message.sender}
    />
  );
}
