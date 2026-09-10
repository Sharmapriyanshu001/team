import StaffList from "./StaffList";

export default function AllOperationsManagers() {
  return (
    <StaffList
      resource="operations-managers"
      title="All Operations Managers"
      subtitle="Leaders who own projects and manage employee teams"
      addPath="/admin/operations-managers/add"
    />
  );
}
