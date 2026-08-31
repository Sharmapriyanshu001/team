import TaskBoard from "./TaskBoard";

export default function TaskReviews() {
  return (
    <TaskBoard
      title="Task Reviews"
      subtitle="Submitted work waiting for your sign-off — rate it, then mark it completed"
      baseFilters={{ status: "review" }}
      review
    />
  );
}
