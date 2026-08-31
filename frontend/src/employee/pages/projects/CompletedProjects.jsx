import ProjectList from "./ProjectList";

export default function CompletedProjects() {
  return (
    <ProjectList
      view="completed"
      title="Completed Projects"
      subtitle="Delivered work you were part of"
      emptyTitle="Nothing completed yet"
      emptyMessage="Projects you worked on will land here once they close."
    />
  );
}
