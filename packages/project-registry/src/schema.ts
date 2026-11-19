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

/** One interest in the About page's personal section. */
export const interestSchema = z.object({
  name: content(40),
  description: content(600),
});

/**
 * One of the owner's photos. `file` names two WebP files the web app serves from
 * `public/photos/`: `<file>-sm.webp` (900 px on the long edge) for the gallery and
 * `<file>-lg.webp` (up to 1,800 px) to open; `width` and `height` are the large one's.
 */
export const photoSchema = z.object({
  file: z
    .string()
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase, hyphenated file name'),
  title: content(60),
  /** What the image shows, for screen readers. */
  alt: content(200),
  width: z.number().int().min(1).max(4_000),
  height: z.number().int().min(1).max(4_000),
});

/** The personal side of About: a short introduction, the owner's interests, and photos. */
export const personalSchema = z.object({
  intro: content(500),
  interests: z.array(interestSchema).min(2).max(10),
  photos: z.array(photoSchema).max(12).optional(),
});

export const profileLinkSchema = z.object({
  label: content(40),
  href: httpsUrl,
});

/** Identifies an experience entry, also as the Experience page's list key (unambiguous JSON). */
export function experienceKey(entry: { organization: string; period: string }): string {
  return JSON.stringify([entry.organization, entry.period]);
}

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
    /** Optional, so a fork can leave the personal section out. */
    personal: personalSchema.optional(),
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
    const seen = new Set<string>();
    for (const entry of profile.experience) {
      const key = experienceKey(entry);
      if (seen.has(key))
        issue(`duplicate experience entry: ${entry.organization} (${entry.period})`);
      seen.add(key);
    }
    for (const duplicate of duplicates(profile.personal?.interests.map(({ name }) => name) ?? [])) {
      issue(`duplicate interest: ${duplicate}`);
    }
    for (const duplicate of duplicates(profile.personal?.photos?.map(({ file }) => file) ?? [])) {
      issue(`duplicate photo: ${duplicate}`);
    }
    for (const entry of profile.experience) {
      for (const duplicate of duplicates(entry.highlights)) {
        issue(`duplicate highlight in ${entry.organization}: ${duplicate.slice(0, 40)}`);
      }
    }
  });

/**
 * A repository-relative path to a file, or to a folder when it ends with `/`. Segments are plain
 * names (no `.` or `..`), so a note can never point outside the repository.
 */
const repositoryPath = z
  .string()
  .max(200)
  .regex(/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\/?$/, 'must be a relative path like docs/a.md')
  .refine((value) => value.split('/').every((part) => part !== '.' && part !== '..'), {
    message: 'must not contain . or .. segments',
  });

/** One short, self-contained explanation of how part of the site works, with its source. */
export const docNoteSchema = z.object({
  slug,
  title: content(80),
  /** Extra search words a visitor might use (synonyms, tools); never shown. */
  keywords: z.array(content(30)).max(12),
  /** At most 400 characters, so a note always fits a chat snippet whole with its source line. */
  text: content(400),
  source: repositoryPath,
});

/**
 * Curated notes from the architecture docs that the chat assistant answers "how does X work?"
 * from. Sources link to `repositoryUrl` on `branch`, so a fork points them at its own copy.
 */
export const docNotesSchema = z
  .object({
    repositoryUrl: httpsUrl.refine((value) => !value.endsWith('/'), {
      message: 'must not end with /',
    }),
    branch: z
      .string()
      .max(100)
      .regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/, 'must be a branch name'),
    notes: z.array(docNoteSchema),
  })
  .superRefine((docs, context) => {
    for (const duplicate of duplicates(docs.notes.map((note) => note.slug))) {
      context.addIssue({ code: 'custom', message: `duplicate doc note slug: ${duplicate}` });
    }
    for (const duplicate of duplicates(docs.notes.map((note) => note.title.toLowerCase()))) {
      context.addIssue({ code: 'custom', message: `duplicate doc note title: ${duplicate}` });
    }
  });

export type DocNotesInput = z.input<typeof docNotesSchema>;
export type DocNotes = z.output<typeof docNotesSchema>;
export type DocNote = z.output<typeof docNoteSchema>;

export type ProfileInput = z.input<typeof profileSchema>;
export type Profile = z.output<typeof profileSchema>;
export type ExperienceEntry = z.output<typeof experienceEntrySchema>;
