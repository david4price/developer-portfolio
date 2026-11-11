import { z } from 'zod';

export const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase kebab-case')
  .max(64);

const httpsUrl = z.url().refine((value) => new URL(value).protocol === 'https:', {
  message: 'must use https',
});

export const projectSchema = z.object({
  slug,
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(200),
  description: z.string().min(1).max(4_000),
  kind: z.enum(['portfolio-app', 'external-repository']),
  technologies: z.array(z.string().min(1).max(40)).min(1).max(20),
  featured: z.boolean(),
  repositoryUrl: httpsUrl.nullable(),
  liveUrl: httpsUrl.nullable(),
  miniAppSlug: slug.nullable(),
});

export const miniAppSchema = z.object({
  slug,
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(200),
  status: z.enum(['available', 'planned']),
});

export const registrySchema = z
  .object({
    projects: z.array(projectSchema),
    miniApps: z.array(miniAppSchema),
  })
  .superRefine((registry, context) => {
    const duplicates = (slugs: readonly string[]) =>
      slugs.filter((value, index) => slugs.indexOf(value) !== index);

    for (const duplicate of duplicates(registry.projects.map((project) => project.slug))) {
      context.addIssue({ code: 'custom', message: `duplicate project slug: ${duplicate}` });
    }
    for (const duplicate of duplicates(registry.miniApps.map((app) => app.slug))) {
      context.addIssue({ code: 'custom', message: `duplicate mini-app slug: ${duplicate}` });
    }

    const miniAppSlugs = new Set(registry.miniApps.map((app) => app.slug));
    for (const project of registry.projects) {
      if (project.miniAppSlug !== null && !miniAppSlugs.has(project.miniAppSlug)) {
        context.addIssue({
          code: 'custom',
          message: `project ${project.slug} references unknown mini-app ${project.miniAppSlug}`,
        });
      }
      if (project.kind === 'external-repository' && project.repositoryUrl === null) {
        context.addIssue({
          code: 'custom',
          message: `external project ${project.slug} must link its repository`,
        });
      }
    }
  });

export type RegistryInput = z.input<typeof registrySchema>;
