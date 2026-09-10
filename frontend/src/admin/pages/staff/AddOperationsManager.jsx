import StaffForm from "./StaffForm";

export default function AddOperationsManager() {
  return (
    <StaffForm
      resource="operations-managers"
      title="Operations Manager"
      listPath="/admin/operations-managers"
    />
  );
}
