import type { MiniAppSummary, ProjectDetail, ProjectSummary } from '@portfolio/shared-types';
import { registryData } from './data.js';
import { registrySchema, type RegistryInput } from './schema.js';

export { miniAppSchema, projectSchema, registrySchema, slug } from './schema.js';
export type { RegistryInput } from './schema.js';

export interface ProjectRegistry {
  readonly projects: readonly ProjectDetail[];
  readonly miniApps: readonly MiniAppSummary[];
}

export function createRegistry(input: RegistryInput): ProjectRegistry {
  return registrySchema.parse(input);
}

/** The validated registry shipped with this repository. */
export const registry: ProjectRegistry = createRegistry(registryData);

export function toProjectSummary(project: ProjectDetail): ProjectSummary {
  const { slug, title, summary, kind, technologies, featured } = project;
  return { slug, title, summary, kind, technologies, featured };
}

export function findProject(
  slug: string,
  source: ProjectRegistry = registry,
): ProjectDetail | undefined {
  return source.projects.find((project) => project.slug === slug);
}

export function findMiniApp(
  slug: string,
  source: ProjectRegistry = registry,
): MiniAppSummary | undefined {
  return source.miniApps.find((app) => app.slug === slug);
}

/** Route parameters for statically exported `/projects/[slug]` pages. */
export function projectRouteParams(source: ProjectRegistry = registry): { slug: string }[] {
  return source.projects.map(({ slug }) => ({ slug }));
}

/** Route parameters for statically exported `/apps/[slug]` pages. */
export function miniAppRouteParams(source: ProjectRegistry = registry): { slug: string }[] {
  return source.miniApps.map(({ slug }) => ({ slug }));
}
