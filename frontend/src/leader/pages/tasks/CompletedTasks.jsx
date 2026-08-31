import TaskList from "./TaskList";

export default function CompletedTasks() {
  return (
    <TaskList
      title="Completed Tasks"
      subtitle="Signed-off work across your projects"
      baseFilters={{ status: "completed" }}
      showRating
    />
  );
}
