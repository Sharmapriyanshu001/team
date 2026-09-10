import LeavePoliciesPage from "../../shared/hr/LeavePoliciesPage";
import leaderApi from "../leaderApi";

/**
 * The leave rules, as an operations manager sees them.
 *
 * The same screen HR writes them on, with every permission answered "no" — so
 * it renders as a plain list: no Add button, no row click, no delete. Writing
 * policy is HR's job and the router behind this panel mounts only the read.
 *
 * It is here because approving leave without knowing the rules is guesswork:
 * a manager saying yes to a fourth consecutive day should be able to see that
 * the policy caps it at three.
 */
const readOnly = () => false;

export default function LeavePolicies() {
  return (
    <LeavePoliciesPage
      api={leaderApi}
      basePath="/leader"
      can={readOnly}
      title="Leave Policies"
      subtitle="What the company grants, and the rules you are approving against"
    />
  );
}
