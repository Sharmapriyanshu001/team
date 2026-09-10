import ProjectList from "./ProjectList";

export default function ActiveProjects() {
  return (
    <ProjectList
      view="active"
      title="Active Projects"
      subtitle="Projects you are currently on"
      emptyTitle="No active projects"
      emptyMessage="Your operations manager adds you to projects from the admin side."
    />
  );
}
