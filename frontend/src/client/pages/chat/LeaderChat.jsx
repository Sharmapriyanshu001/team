import ChatPanel from "../../../shared/components/ChatPanel";
import clientApi from "../../clientApi";

export default function LeaderChat() {
  return (
    <ChatPanel
      api={clientApi}
      base="/client"
      tab="operations_manager"
      title="Operations Manager Chat"
      subtitle="Talk to the leads running your projects"
      // Staff messages carry a sender id; a client's never does
      mineWhen={(message) => !message.sender}
    />
  );
}
