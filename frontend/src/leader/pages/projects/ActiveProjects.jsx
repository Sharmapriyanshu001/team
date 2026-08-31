import ProjectList from "./ProjectList";

export default function ActiveProjects() {
  return (
    <ProjectList
      view="active"
      title="Active Projects"
      subtitle="Everything you are currently delivering"
      emptyTitle="No active projects"
      emptyMessage="Projects the admin assigns to you will appear here."
    />
  );
}
