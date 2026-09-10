import LeavePoliciesPage from "../../shared/hr/LeavePoliciesPage";
import hrApi from "../hrApi";
import useHrAccess from "../hooks/useHrAccess";

export default function LeavePolicies() {
  const { can } = useHrAccess();
  return <LeavePoliciesPage api={hrApi} basePath="/hr" can={can} />;
}
