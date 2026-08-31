import TaskBoard from "./TaskBoard";

export default function PendingTasks() {
  return (
    <TaskBoard
      title="Pending Tasks"
      subtitle="Work that has not been started yet"
      baseFilters={{ status: "pending" }}
    />
  );
}
