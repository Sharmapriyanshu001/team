import TaskBoard from "./TaskBoard";

export default function CompletedTasks() {
  return (
    <TaskBoard
      title="Completed Tasks"
      subtitle="Delivered work, newest first"
      baseFilters={{ status: "completed" }}
      review
    />
  );
}
