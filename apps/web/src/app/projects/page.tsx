import { registry, toProjectSummary } from '@portfolio/project-registry';
import type { Metadata } from 'next';
import { ProjectCard } from '@/components/project-card';

export const metadata: Metadata = {
  title: 'Projects',
  description: 'Projects, architecture notes, and integrated mini-apps.',
};

export default function ProjectsPage() {
  return (
    <>
      <h1>Projects</h1>
      <ul className="grid">
        {registry.projects.map((project) => (
          <li key={project.slug}>
            <ProjectCard project={toProjectSummary(project)} />
          </li>
        ))}
      </ul>
    </>
  );
}
