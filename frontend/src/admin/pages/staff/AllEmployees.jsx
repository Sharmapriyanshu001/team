import StaffList from "./StaffList";

export default function AllEmployees() {
  return (
    <StaffList
      resource="employees"
      title="All Employees"
      subtitle="Everyone working on site and in the office"
      addPath="/admin/employees/add"
      showTeamLeader
    />
  );
}
