import { miniAppPath, type ProjectRegistry, projectPath } from '@portfolio/project-registry';
import type {
  ChatLink,
  ChatLinkKind,
  MiniAppSummary,
  ProjectDetail,
} from '@portfolio/shared-types';
import type { KnowledgeBase } from './knowledge-base.js';
import { linkMarker } from './navigation-links.js';

/** Longest snippet one registry item contributes (always enforced); three fit the data budget. */
export const SNIPPET_MAX_CHARS = 580;

/** Words too common to say anything about which item a question is about. */
const STOP_WORDS = new Set(
  (
    'a about an and any are as at be been but by can could did do does for from had has have he ' +
    'her his how i if in into is it its me my of on or our she so some tell than that the their ' +
    'them then there these they this those to us was we were what when where which who why will ' +
    'with would you your project app work built build use used using'
  ).split(' '),
);

/** Folds simple plurals so "projects" matches "project". Applied to queries and content alike. */
const stem = (word: string) =>
  word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;

/** Lowercase search terms; punctuation separates words ("Next.js" → "next", "js"). */
export function searchTerms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map(stem)
    .filter((word) => !STOP_WORDS.has(word));
}

interface Field {
  readonly weight: number;
  readonly terms: ReadonlySet<string>;
}

interface Entry {
  readonly link: ChatLink;
  readonly fields: readonly Field[];
  readonly snippet: string;
  readonly featured: boolean;
}

const field = (weight: number, ...texts: string[]): Field => ({
  weight,
  terms: new Set(searchTerms(texts.join(' '))),
});

/** Lowercase words joined by hyphens, so "Recipe Finder" and "recipe-finder" name one page. */
const nameKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const miniAppStatus = (app: MiniAppSummary) =>
  app.status === 'available' ? 'available now' : 'planned, not built yet';

/** Cuts `text` at a word boundary so the result, with an ellipsis, fits `maxChars`. */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars < 2) return '';
  const cut = text.slice(0, maxChars - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Prose cut shorter than this says too little to be worth the space. */
const MIN_PROSE_CHARS = 40;

/**
 * Builds a snippet line by line within `SNIPPET_MAX_CHARS`; earlier lines take priority. Prose is
 * cut at a word boundary to fit, while URLs and link markers are kept whole or left out, because
 * a truncated one is wrong rather than shorter.
 */
class SnippetBuilder {
  private readonly parts: string[];
  private room: number;

  /**
   * `firstLine` (marker and title) is always kept: the registry schema caps slugs at 64 and
   * titles at 80 characters, so it can never come near the limit on its own.
   */
  constructor(firstLine: string) {
    this.parts = [firstLine];
    this.room = SNIPPET_MAX_CHARS - firstLine.length;
  }

  whole(label: string, value: string): this {
    this.append(`\n${label}: ${value}`);
    return this;
  }

  prose(label: string, value: string): this {
    const text = value.trim();
    if (text === '') return this;
    const prefix = `\n${label}: `;
    const space = this.room - prefix.length;
    if (space >= Math.min(MIN_PROSE_CHARS, text.length)) {
      this.append(`${prefix}${truncate(text, space)}`);
    }
    return this;
  }

  toString(): string {
    return this.parts.join('');
  }

  private append(part: string): void {
    if (part.length > this.room) return;
    this.parts.push(part);
    this.room -= part.length;
  }
}

function projectSnippet(project: ProjectDetail, miniApp: MiniAppSummary | undefined): string {
  const snippet = new SnippetBuilder(`${linkMarker('project', project.slug)} ${project.title}`);
  snippet.prose('Summary', project.summary);
  if (miniApp !== undefined) {
    snippet.whole(
      'Mini-app',
      `${linkMarker('mini-app', miniApp.slug)} ${miniApp.title} (${miniAppStatus(miniApp)})`,
    );
  }
  snippet.prose('Technologies', project.technologies.join(', '));
  if (project.repositoryUrl !== null) snippet.whole('Repository', project.repositoryUrl);
  if (project.liveUrl !== null) snippet.whole('Live site', project.liveUrl);
  return snippet.prose('Details', project.description).toString();
}

function miniAppSnippet(app: MiniAppSummary): string {
  return truncate(
    `${linkMarker('mini-app', app.slug)} ${app.title}\nStatus: ${miniAppStatus(app)}\nSummary: ${app.summary}`,
    SNIPPET_MAX_CHARS,
  );
}

/**
 * Keyword retrieval over the project registry, held in memory: the registry ships with the API,
 * so search needs no I/O and every replica answers identically. Ranking is a weighted term match
 * (title and slug count most, then technologies and summary, then the description), scaled by how
 * rare each term is across the registry.
 */
export class RegistryKnowledgeBase implements KnowledgeBase {
  private readonly entries: readonly Entry[];
  /** Pages by name key, per kind and across kinds (projects win a clash across kinds). */
  private readonly byKind: ReadonlyMap<string, ChatLink>;
  private readonly byName: ReadonlyMap<string, ChatLink>;
  /** Inverse document frequency per term, computed once: the registry never changes at runtime. */
  private readonly rarity: ReadonlyMap<string, number>;

  constructor(registry: ProjectRegistry) {
    const miniApps = new Map(registry.miniApps.map((app) => [app.slug, app]));
    const projectEntries = registry.projects.map((project): Entry => ({
      link: {
        kind: 'project',
        slug: project.slug,
        title: project.title,
        path: projectPath(project.slug),
      },
      fields: [
        field(3, project.title, project.slug),
        field(2, ...project.technologies),
        field(2, project.summary),
        field(1, project.description),
      ],
      snippet: projectSnippet(
        project,
        project.miniAppSlug === null ? undefined : miniApps.get(project.miniAppSlug),
      ),
      featured: project.featured,
    }));
    const miniAppEntries = registry.miniApps.map((app): Entry => ({
      link: { kind: 'mini-app', slug: app.slug, title: app.title, path: miniAppPath(app.slug) },
      fields: [field(3, app.title, app.slug), field(2, app.summary)],
      snippet: miniAppSnippet(app),
      featured: false,
    }));
    this.entries = [...projectEntries, ...miniAppEntries];

    const byKind = new Map<string, ChatLink>();
    const byName = new Map<string, ChatLink>();
    for (const { link } of this.entries) {
      for (const key of [nameKey(link.slug), nameKey(link.title)]) {
        if (!byKind.has(`${link.kind}:${key}`)) byKind.set(`${link.kind}:${key}`, link);
        if (!byName.has(key)) byName.set(key, link);
      }
    }
    this.byKind = byKind;
    this.byName = byName;

    // A term found in every entry says little about any one of them.
    const containing = new Map<string, number>();
    for (const entry of this.entries) {
      const terms = new Set(entry.fields.flatMap((item) => [...item.terms]));
      for (const term of terms) containing.set(term, (containing.get(term) ?? 0) + 1);
    }
    this.rarity = new Map(
      [...containing].map(([term, count]) => [term, Math.log(1 + this.entries.length / count)]),
    );
  }

  search(query: string, limit: number): readonly string[] {
    if (limit <= 0) return [];
    const queryTerms = new Set(searchTerms(query));
    const scored = this.entries
      .map((entry, index) => ({ entry, index, score: this.score(entry, queryTerms) }))
      .filter(({ score }) => score > 0)
      // Best first; registry order breaks ties so results are deterministic.
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const matches =
      scored.length > 0
        ? scored.map(({ entry }) => entry)
        : this.entries.filter((entry) => entry.featured);
    return matches.slice(0, limit).map(({ snippet }) => snippet);
  }

  resolve(name: string, kind?: ChatLinkKind): ChatLink | undefined {
    const key = nameKey(name);
    if (key === '') return undefined;
    return kind === undefined ? this.byName.get(key) : this.byKind.get(`${kind}:${key}`);
  }

  private score(entry: Entry, queryTerms: ReadonlySet<string>): number {
    let score = 0;
    for (const term of queryTerms) {
      const weight = Math.max(
        0,
        ...entry.fields.filter((item) => item.terms.has(term)).map((item) => item.weight),
      );
      if (weight > 0) score += weight * (this.rarity.get(term) ?? 0);
    }
    return score;
  }
}
