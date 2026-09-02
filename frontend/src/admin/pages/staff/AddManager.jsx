import StaffForm from "./StaffForm";

export default function AddManager() {
  return <StaffForm resource="managers" title="Manager" listPath="/admin/managers" />;
}
