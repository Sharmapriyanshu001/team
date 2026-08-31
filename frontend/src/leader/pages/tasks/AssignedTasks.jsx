import TaskList from "./TaskList";

export default function AssignedTasks() {
  return (
    <TaskList
      title="Assigned Tasks"
      subtitle="Everything currently handed to someone on your team"
      baseFilters={{ view: "assigned" }}
    />
  );
}
