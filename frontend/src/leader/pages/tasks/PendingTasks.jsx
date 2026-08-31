import TaskList from "./TaskList";

export default function PendingTasks() {
  return (
    <TaskList
      title="Pending Tasks"
      subtitle="Not started yet — chase these first"
      baseFilters={{ status: "pending" }}
    />
  );
}
