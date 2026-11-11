import { registry, toProjectSummary } from '@portfolio/project-registry';
import Link from 'next/link';
import { ApiStatus } from '@/components/api-status';
import { ProjectCard } from '@/components/project-card';
import { profile } from '@/content/profile';

export default function HomePage() {
  const featured = registry.projects.filter((project) => project.featured).map(toProjectSummary);

  return (
    <>
      <section aria-labelledby="intro-heading">
        <h1 id="intro-heading">{profile.name}</h1>
        <p className="lead">{profile.headline}</p>
        <p>{profile.intro}</p>
        <ApiStatus />
      </section>

      <section aria-labelledby="featured-heading">
        <h2 id="featured-heading">Featured projects</h2>
        <ul className="grid">
          {featured.map((project) => (
            <li key={project.slug}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
        <p>
          <Link href="/projects/">All projects</Link>
        </p>
      </section>
    </>
  );
}
