import LeavePage from "../../shared/leave/LeavePage";
import leaderApi from "../leaderApi";

/**
 * A manager asking for their own time off.
 *
 * They could already see the leave policies and approve nothing but their
 * team's attendance — the one group in the company able to read the rules and
 * unable to use them. Their request goes to HR and to the administrators,
 * because a department head being away is something the business plans around.
 */
export default function LeaderLeave() {
  return (
    <LeavePage
      api={leaderApi}
      base="/leader"
      title="My Leave"
      subtitle="Your request goes to HR and the administrators"
    />
  );
}
