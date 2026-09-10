import TaskList from "./TaskList";

export default function CompletedTasks() {
  return (
    <TaskList
      title="Completed"
      subtitle="Work your operations manager has signed off"
      baseFilters={{ status: "completed" }}
      readOnly
    />
  );
}
