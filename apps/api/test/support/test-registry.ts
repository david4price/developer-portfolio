import {
  createDocNotes,
  createRegistry,
  type DocNotes,
  type ProjectRegistry,
} from '@portfolio/project-registry';

/** A small, fixed registry so retrieval tests don't depend on the shipped portfolio content. */
export const testRegistry: ProjectRegistry = createRegistry({
  projects: [
    {
      slug: 'homelab-cluster',
      title: 'Homelab Cluster',
      summary: 'Single-node Kubernetes cluster managed with GitOps.',
      description: 'K3s with Argo CD, Sealed Secrets, and nightly PostgreSQL backups.',
      kind: 'portfolio-app',
      technologies: ['Kubernetes', 'Argo CD', 'Helm'],
      featured: false,
      repositoryUrl: null,
      liveUrl: null,
      miniAppSlug: 'infrastructure-explorer',
    },
    {
      slug: 'recipe-finder',
      title: 'Recipe Finder',
      summary: 'Search recipes by the ingredients already in your fridge.',
      description: 'A React front end over a small Go API with full-text search.',
      kind: 'external-repository',
      technologies: ['React', 'Go'],
      featured: true,
      repositoryUrl: 'https://github.com/example/recipe-finder',
      liveUrl: 'https://recipes.example.com',
      miniAppSlug: null,
    },
    {
      slug: 'weather-bot',
      title: 'Weather Bot',
      summary: 'A chat bot that answers weather questions.',
      description: 'Built with TypeScript and a public forecast API.',
      kind: 'external-repository',
      technologies: ['TypeScript'],
      featured: false,
      repositoryUrl: 'https://github.com/example/weather-bot',
      liveUrl: null,
      miniAppSlug: null,
    },
  ],
  miniApps: [
    {
      slug: 'infrastructure-explorer',
      title: 'Infrastructure Explorer',
      summary: 'Live, sanitized view of the cluster.',
      status: 'planned',
    },
  ],
});

/** Fixed architecture notes for retrieval and link tests. */
export const testDocNotes: DocNotes = createDocNotes({
  repositoryUrl: 'https://github.com/example/portfolio',
  branch: 'main',
  notes: [
    {
      slug: 'release-flow',
      title: 'Release Flow',
      keywords: ['deploy', 'pipeline'],
      text: 'Images are built in CI and synced to the cluster from Git.',
      source: 'docs/release.md',
    },
    {
      slug: 'api-design',
      title: 'API Design',
      keywords: ['backend', 'endpoints'],
      text: 'One modular monolith with validated inputs and typed errors.',
      source: 'apps/api/src/',
    },
  ],
});

/** No architecture notes, for tests about registry items alone. */
export const noDocNotes: DocNotes = createDocNotes({
  repositoryUrl: 'https://github.com/example/portfolio',
  branch: 'main',
  notes: [],
});
