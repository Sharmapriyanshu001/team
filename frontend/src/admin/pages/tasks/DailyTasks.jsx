import TaskBoard from "./TaskBoard";

export default function DailyTasks() {
  return (
    <TaskBoard
      title="Daily Tasks"
      subtitle="Everything due today across all projects"
      baseFilters={{ due: "today" }}
    />
  );
}
