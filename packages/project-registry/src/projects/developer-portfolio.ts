import type { ProjectInput } from '../schema.js';

export const developerPortfolio: ProjectInput = {
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
};
