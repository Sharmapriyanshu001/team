import CalendarPanel from "../../shared/components/CalendarPanel";
import employeeApi from "../employeeApi";

export default function Calendar() {
  return (
    <CalendarPanel
      api={employeeApi}
      base="/employee"
      title="Calendar"
      subtitle="Your deadlines and the milestones on your projects"
      taskLinkBase="/employee/tasks/details"
    />
  );
}
