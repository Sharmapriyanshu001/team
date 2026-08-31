import ProjectList from "./ProjectList";

export default function ActiveProjects() {
  return (
    <ProjectList
      view="active"
      title="Active Projects"
      subtitle="Projects you are currently on"
      emptyTitle="No active projects"
      emptyMessage="Your team leader adds you to projects from the admin side."
    />
  );
}
