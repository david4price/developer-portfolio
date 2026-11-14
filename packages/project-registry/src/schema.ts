import { z } from 'zod';
import { containsHiddenText, controlMarkupIn } from './control-markup.js';

export const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase kebab-case')
  .max(64);

const httpsUrl = z.url().refine((value) => new URL(value).protocol === 'https:', {
  message: 'must use https',
});

/**
 * Text that reaches the chat assistant's prompt. Control markup and hidden text
 * (`control-markup.ts`) are rejected here, at the source, so content reaches the model exactly as
 * written and can never pose as prompt structure or hide instructions.
 */
const content = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => controlMarkupIn(value).size === 0, {
      message:
        'must not contain prompt control markup (data delimiters, template tokens, role tags)',
    })
    .refine((value) => !containsHiddenText(value), {
      message: 'must not contain hidden text (Unicode tag characters, bidi overrides, controls)',
    });

export const projectSchema = z.object({
  slug,
  title: content(80),
  summary: content(200),
  description: content(4_000),
  kind: z.enum(['portfolio-app', 'external-repository']),
  technologies: z.array(content(40)).min(1).max(20),
  featured: z.boolean(),
  repositoryUrl: httpsUrl.nullable(),
  liveUrl: httpsUrl.nullable(),
  miniAppSlug: slug.nullable(),
});

export const miniAppSchema = z.object({
  slug,
  title: content(80),
  summary: content(200),
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
