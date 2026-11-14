import {
  findMiniApp,
  findProject,
  miniAppPath,
  projectRouteParams,
} from '@portfolio/project-registry';
import { TechList } from '@portfolio/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

interface ProjectPageProps {
  readonly params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return projectRouteParams();
}

export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const project = findProject((await params).slug);
  return project === undefined ? {} : { title: project.title, description: project.summary };
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const project = findProject((await params).slug);
  if (project === undefined) notFound();

  const miniApp = project.miniAppSlug === null ? undefined : findMiniApp(project.miniAppSlug);

  return (
    <article>
      <h1>{project.title}</h1>
      <p className="lead">{project.summary}</p>
      <TechList items={project.technologies} />
      <p>{project.description}</p>

      <ul>
        {project.repositoryUrl !== null && (
          <li>
            <a href={project.repositoryUrl}>Source code</a>
          </li>
        )}
        {project.liveUrl !== null && (
          <li>
            <a href={project.liveUrl}>Live site</a>
          </li>
        )}
        {miniApp !== undefined && (
          <li>
            <Link href={miniAppPath(miniApp.slug)}>{miniApp.title}</Link>
          </li>
        )}
      </ul>
    </article>
  );
}
