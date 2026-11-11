import type { ProjectSummary } from '@portfolio/shared-types';
import { Card, TechList } from '@portfolio/ui';
import Link from 'next/link';

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Card
      title={<Link href={`/projects/${project.slug}/`}>{project.title}</Link>}
      footer={<TechList items={project.technologies} />}
    >
      <p>{project.summary}</p>
    </Card>
  );
}
