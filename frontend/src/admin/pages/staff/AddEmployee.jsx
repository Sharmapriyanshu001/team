import StaffForm from "./StaffForm";

export default function AddEmployee() {
  return (
    <StaffForm
      resource="employees"
      title="Employee"
      listPath="/admin/employees"
      showOperationsManager
    />
  );
}
