import StageList from "./StageList";

/**
 * Agreed to take. Includes rows spelled "offer" by the build that predates
 * this section — same decision, older word.
 */
const STAGES = ["selected", "offer"];

export default function Selected() {
  return (
    <StageList
      stages={STAGES}
      title="Selected"
      subtitle="candidates the company has agreed to take"
      emptyTitle="Nobody selected"
      emptyMessage="Move a shortlisted candidate to Selected and their onboarding opens."
    />
  );
}
