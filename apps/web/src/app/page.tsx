import { profile, registry, toProjectSummary } from '@portfolio/project-registry';
import Link from 'next/link';
import { ApiStatus } from '@/components/api-status';
import { ProjectCard } from '@/components/project-card';

export default function HomePage() {
  const featured = registry.projects.filter((project) => project.featured).map(toProjectSummary);

  return (
    <>
      <section aria-labelledby="intro-heading">
        {/* The name is already in the header; the headline leads the page instead. */}
        <h1 id="intro-heading" className="home-title">
          {profile.headline}
        </h1>
        <p>{profile.intro}</p>
        <p>
          Live status of this site&apos;s self-hosted API: <ApiStatus />
        </p>
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
          <Link href="/projects/" className="more-link">
            All projects <span aria-hidden="true">→</span>
          </Link>
        </p>
      </section>
    </>
  );
}
