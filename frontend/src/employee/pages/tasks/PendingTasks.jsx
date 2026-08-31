import TaskList from "./TaskList";

export default function PendingTasks() {
  return (
    <TaskList
      title="Pending"
      subtitle="Assigned to you and still open"
      baseFilters={{ view: "open" }}
    />
  );
}
