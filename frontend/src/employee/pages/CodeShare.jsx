import employeeApi from "../employeeApi";
import CodeShareBoard from "../../shared/components/CodeShareBoard";

export default function CodeShare() {
  return (
    <CodeShareBoard
      api={employeeApi}
      base="/employee"
      subtitle="Send a code archive to your team leader or colleagues, and pick up what they send you"
    />
  );
}
