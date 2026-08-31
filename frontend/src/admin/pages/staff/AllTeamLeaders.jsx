import StaffList from "./StaffList";

export default function AllTeamLeaders() {
  return (
    <StaffList
      resource="team-leaders"
      title="All Team Leaders"
      subtitle="Leaders who own projects and manage employee teams"
      addPath="/admin/team-leaders/add"
    />
  );
}
