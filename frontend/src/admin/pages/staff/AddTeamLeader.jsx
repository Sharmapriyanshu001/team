import StaffForm from "./StaffForm";

export default function AddTeamLeader() {
  return (
    <StaffForm
      resource="team-leaders"
      title="Team Leader"
      listPath="/admin/team-leaders"
    />
  );
}
