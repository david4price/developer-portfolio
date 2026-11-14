import { createRegistry, type ProjectRegistry } from '@portfolio/project-registry';

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
