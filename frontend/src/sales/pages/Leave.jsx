import LeavePage from "../../shared/leave/LeavePage";
import salesApi from "../salesApi";

/** Sales asking for their own time off — HR and the administrators decide. */
export default function SalesLeave() {
  return (
    <LeavePage
      api={salesApi}
      base="/sales"
      title="My Leave"
      subtitle="Your request goes to HR and the administrators"
    />
  );
}
