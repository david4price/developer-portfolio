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

const duplicates = (values: readonly string[]) =>
  values.filter((value, index) => values.indexOf(value) !== index);

export const registrySchema = z
  .object({
    projects: z.array(projectSchema),
    miniApps: z.array(miniAppSchema),
  })
  .superRefine((registry, context) => {
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

export const experienceEntrySchema = z.object({
  role: content(80),
  organization: content(80),
  period: content(40),
  highlights: z.array(content(300)).min(1).max(8),
});

export const profileLinkSchema = z.object({
  label: content(40),
  href: httpsUrl,
});

/**
 * The owner's profile: home page introduction, About, and Experience. Every text field goes
 * through `content`, like the registry, so the chat assistant can index it safely.
 */
export const profileSchema = z
  .object({
    name: content(80),
    headline: content(120),
    intro: content(800),
    about: z.array(content(1_200)).min(1).max(6),
    links: z.array(profileLinkSchema).max(10),
    experience: z.array(experienceEntrySchema).max(20),
  })
  .superRefine((profile, context) => {
    // The site keys these lists by their text, so each entry must be unique.
    const issue = (message: string) => context.addIssue({ code: 'custom', message });

    for (const duplicate of duplicates(profile.about)) {
      issue(`duplicate about paragraph: ${duplicate.slice(0, 40)}`);
    }
    for (const duplicate of duplicates(profile.links.map((link) => link.href))) {
      issue(`duplicate profile link: ${duplicate}`);
    }
    for (const duplicate of duplicates(
      profile.experience.map((entry) => `${entry.organization} (${entry.period})`),
    )) {
      issue(`duplicate experience entry: ${duplicate}`);
    }
    for (const entry of profile.experience) {
      for (const duplicate of duplicates(entry.highlights)) {
        issue(`duplicate highlight in ${entry.organization}: ${duplicate.slice(0, 40)}`);
      }
    }
  });

export type ProfileInput = z.input<typeof profileSchema>;
export type Profile = z.output<typeof profileSchema>;
export type ExperienceEntry = z.output<typeof experienceEntrySchema>;
