import StageList from "./StageList";

/** Worth taking forward. The decision after the interviews. */
const STAGES = ["shortlisted"];

export default function Shortlisted() {
  return (
    <StageList
      stages={STAGES}
      title="Shortlisted"
      subtitle="candidates worth taking forward"
      advanceTo="selected"
      advanceLabel="Select"
      emptyTitle="Nobody shortlisted"
      emptyMessage="Shortlist a candidate from Interviews or the Candidates list."
    />
  );
}
