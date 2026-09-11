import TaskList from "./TaskList";

export default function InProgressTasks() {
  return (
    <TaskList
      title="In Progress"
      subtitle="Work you have started — submit it when it is ready"
      baseFilters={{ status: "in_progress" }}
    />
  );
}
