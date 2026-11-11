import type { RegistryInput } from './schema.js';

/**
 * Portfolio content. Replace or extend these entries with your own projects; the registry is
 * validated at import time, so a malformed entry fails the build and the tests.
 */
export const registryData: RegistryInput = {
  projects: [
    {
      slug: 'developer-portfolio',
      title: 'Developer Portfolio Platform',
      summary:
        'This site: a static Next.js frontend with a NestJS API, background workers, and GitOps deployment.',
      description:
        'A modular monorepo containing the statically exported portfolio, a versioned REST API, a ' +
        'BullMQ worker, and shared TypeScript contracts. It runs locally with Docker Compose and in ' +
        'production on single-node K3s managed by Argo CD.',
      kind: 'portfolio-app',
      technologies: ['TypeScript', 'Next.js', 'React', 'NestJS', 'PostgreSQL', 'Redis', 'BullMQ'],
      featured: true,
      repositoryUrl: 'https://github.com/david4price/developer-portfolio',
      liveUrl: null,
      miniAppSlug: 'infrastructure-explorer',
    },
  ],
  miniApps: [
    {
      slug: 'infrastructure-explorer',
      title: 'Infrastructure Explorer',
      summary: 'Live, sanitized view of the Kubernetes deployment that serves this site.',
      status: 'planned',
    },
    {
      slug: 'portfolio-assistant',
      title: 'Portfolio Assistant',
      summary: 'Ask questions about projects and experience, grounded in this registry.',
      status: 'planned',
    },
  ],
};
