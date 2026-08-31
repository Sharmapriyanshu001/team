import TaskList from "./TaskList";

export default function TodayTasks() {
  return (
    <TaskList
      title="Today's Tasks"
      subtitle="Everything due today — start it, then submit for review"
      baseFilters={{ due: "today" }}
    />
  );
}
