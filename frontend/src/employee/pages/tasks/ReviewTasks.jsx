import TaskList from "./TaskList";

export default function ReviewTasks() {
  return (
    <TaskList
      title="Waiting for Review"
      subtitle="Submitted and with your operations manager"
      baseFilters={{ status: "review" }}
      readOnly
    />
  );
}
