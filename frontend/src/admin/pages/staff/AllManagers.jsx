import StaffList from "./StaffList";

export default function AllManagers() {
  return (
    <StaffList
      resource="managers"
      title="All Managers"
      subtitle="Department heads — they answer for a team's numbers and sign in through the team leader panel"
      addPath="/admin/managers/add"
    />
  );
}
