import type { MiniAppSummary, ProjectDetail, ProjectSummary } from '@portfolio/shared-types';
import { registryData } from './data.js';
import { docNotesData } from './docs-data.js';
import { profileData } from './profile-data.js';
import {
  docNotesSchema,
  type DocNote,
  type DocNotes,
  type DocNotesInput,
  profileSchema,
  registrySchema,
  type Profile,
  type ProfileInput,
  type RegistryInput,
} from './schema.js';

export {
  type ControlMarkupKind,
  containsHiddenText,
  controlMarkupIn,
  INVISIBLE,
} from './control-markup.js';
export {
  experienceKey,
  docNoteSchema,
  docNotesSchema,
  experienceEntrySchema,
  miniAppSchema,
  profileLinkSchema,
  profileSchema,
  projectSchema,
  registrySchema,
  slug,
} from './schema.js';
export type {
  DocNote,
  DocNotes,
  DocNotesInput,
  ExperienceEntry,
  MiniAppInput,
  Profile,
  ProfileInput,
  ProjectInput,
  RegistryInput,
} from './schema.js';

export interface ProjectRegistry {
  readonly projects: readonly ProjectDetail[];
  readonly miniApps: readonly MiniAppSummary[];
}

export function createRegistry(input: RegistryInput): ProjectRegistry {
  return registrySchema.parse(input);
}

/** The validated registry shipped with this repository. */
export const registry: ProjectRegistry = createRegistry(registryData);

export function createProfile(input: ProfileInput): Profile {
  return profileSchema.parse(input);
}

/** The validated owner profile shipped with this repository (home page, About, Experience). */
export const profile: Profile = createProfile(profileData);

/**
 * Fixed site pages the chat assistant may link to by slug (P5-13), besides projects and
 * mini-apps: where the profile it answers from is shown.
 */
export const SITE_PAGES = [
  { slug: 'about', title: 'About', path: '/about/' },
  { slug: 'experience', title: 'Experience', path: '/experience/' },
] as const;

export type SitePage = (typeof SITE_PAGES)[number];

export function findSitePage(slug: string): SitePage | undefined {
  return SITE_PAGES.find((page) => page.slug === slug);
}

export function createDocNotes(input: DocNotesInput): DocNotes {
  return docNotesSchema.parse(input);
}

/** The validated architecture notes shipped with this repository, for the chat assistant. */
export const docNotes: DocNotes = createDocNotes(docNotesData);

export function findDocNote(slug: string, source: DocNotes = docNotes): DocNote | undefined {
  return source.notes.find((note) => note.slug === slug);
}

/** Where a note's source opens on GitHub: `tree/` for a folder, `blob/` for a file. */
export function docNoteUrl(note: DocNote, source: DocNotes = docNotes): string {
  const view = note.source.endsWith('/') ? 'tree' : 'blob';
  return `${source.repositoryUrl}/${view}/${source.branch}/${note.source}`;
}

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

/** Site path of a project page. */
export function projectPath(slug: string): string {
  return `/projects/${slug}/`;
}

/** Site path of a mini-app page. */
export function miniAppPath(slug: string): string {
  return `/apps/${slug}/`;
}

/** Route parameters for statically exported `/projects/[slug]` pages. */
export function projectRouteParams(source: ProjectRegistry = registry): { slug: string }[] {
  return source.projects.map(({ slug }) => ({ slug }));
}

/** Route parameters for statically exported `/apps/[slug]` pages. */
export function miniAppRouteParams(source: ProjectRegistry = registry): { slug: string }[] {
  return source.miniApps.map(({ slug }) => ({ slug }));
}
