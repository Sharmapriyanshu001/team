import ProjectList from "./ProjectList";

export default function CompletedProjects() {
  return (
    <ProjectList
      view="completed"
      title="Completed Projects"
      subtitle="Delivered and closed work"
      emptyTitle="Nothing completed yet"
      emptyMessage="Projects you mark as completed will be listed here."
    />
  );
}
