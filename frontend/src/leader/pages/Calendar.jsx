import CalendarPanel from "../../shared/components/CalendarPanel";
import leaderApi from "../leaderApi";

export default function Calendar() {
  return (
    <CalendarPanel
      api={leaderApi}
      base="/leader"
      title="Calendar"
      subtitle="Task deadlines and project milestones across your projects"
    />
  );
}
