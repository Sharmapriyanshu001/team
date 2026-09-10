import StageList from "./StageList";

/**
 * Not taken forward — kept rather than deleted.
 *
 * Where a candidate came from and why they were turned down is the only thing
 * that says whether a source is worth the money, and both die with the record.
 * They can also be put back in the pipeline, which is why this is a list and
 * not an archive.
 */
const STAGES = ["rejected"];

export default function Rejected() {
  return (
    <StageList
      stages={STAGES}
      title="Rejected"
      subtitle="candidates not taken forward"
      showRejection
      emptyTitle="Nobody rejected"
      emptyMessage="Candidates you do not take forward are kept here rather than deleted."
    />
  );
}
