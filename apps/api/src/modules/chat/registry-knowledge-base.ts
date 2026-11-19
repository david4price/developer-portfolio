import {
  type DocNote,
  type DocNotes,
  docNoteUrl,
  miniAppPath,
  type Profile,
  type ProjectRegistry,
  projectPath,
  SITE_PAGES,
  type SitePage,
} from '@portfolio/project-registry';
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
    'with would you your project app work built build use used using happen happened happening'
  ).split(' '),
);

/**
 * Drops a trailing "s" from any word over three letters not ending in "ss", so "projects"
 * matches "project" (but "pushes" becomes "pushe" and "status" "statu"). Applied to queries and
 * content alike.
 */
const stem = (word: string) =>
  word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;

/** Lowercase search terms; punctuation separates words ("Next.js" → "next", "js"). */
export function searchTerms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map(stem)
    .filter((word) => !STOP_WORDS.has(word));
}

/** Every lowercase word of `text`, stop words included. */
const rawWords = (text: string) => text.toLowerCase().match(/[a-z]+/g) ?? [];

interface Field {
  readonly weight: number;
  readonly terms: ReadonlySet<string>;
}

interface Entry {
  readonly link: ChatLink;
  readonly fields: readonly Field[];
  readonly snippet: string;
  readonly featured: boolean;
  /**
   * For architecture notes and profile entries: the words of their text, to tell whether a reply
   * drew on it.
   */
  readonly noteTerms?: ReadonlySet<string>;
  /** A profile entry: it competes only when the question is about the owner (`aboutOwner`). */
  readonly profile?: true;
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
  constructor(
    firstLine: string,
    /** Room kept free for a closing line added with `close()`, so prose never crowds it out. */
    private reserved = 0,
  ) {
    this.parts = [firstLine];
    this.room = SNIPPET_MAX_CHARS - firstLine.length - reserved;
  }

  /** The closing line the reserve was kept for. */
  close(label: string, value: string): this {
    this.room += this.reserved;
    this.reserved = 0;
    return this.whole(label, value);
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
 * The marker sits on a closing `Source:` line, where the reference model copies it far more often
 * than from the header. The schema caps titles, slugs, and note text so the line always fits.
 */
function docSnippet(note: DocNote): string {
  return new SnippetBuilder(note.title)
    .prose('Notes', note.text)
    .whole('Source', linkMarker('doc', note.slug))
    .toString();
}

/**
 * Words visitors use about a person rather than a project, matched only for profile entries:
 * "Where does David work?" leaves just the name once stop words are dropped ("work" is one), so
 * these lift the right part of the profile for "job", "hobbies", "weekends", and the like.
 */
const PROFILE_WORDS = {
  about: 'about bio background who person developer skills skill stack experience',
  work: 'job jobs employer company career role roles position experience worked works',
  personal:
    'hobby hobbies interest interests fun free time spare weekend weekends outside personal ' +
    'passion passions enjoy enjoys like likes',
} as const;

/**
 * Plain forms of "-ing" words in an interest's name ("Surfing" → "surf", "Biking" → "bike",
 * "Running" → "run"), so "Does he surf?" finds it. Search only drops a trailing "s", and
 * changing that for everything is retrieval tuning (P5-10); this stays with the profile.
 */
function interestWordForms(name: string): string {
  return searchTerms(name)
    .filter((word) => word.length > 5 && word.endsWith('ing'))
    .flatMap((word) => {
      const base = word.slice(0, -3);
      const undoubled = /([b-df-hj-np-tv-z])\1$/.test(base) ? base.slice(0, -1) : base;
      return [base, `${base}e`, undoubled];
    })
    .join(' ');
}

/**
 * Words that make a question about a person, read from the raw question since most are stop
 * words: "who", pronouns, "the developer", and clearly personal topics (not "job", which is also
 * a queue's). The owner's name counts too.
 * Without one, profile entries don't compete, so their search-only words ("role", "company",
 * "stack") can't push site answers aside ("What role does Redis play?").
 */
const PERSON_WORDS = new Set(
  (
    'who whose he him his himself she her hers herself developer owner author creator hobby ' +
    'hobbies weekend weekends employer career bio resume cv'
  ).split(' '),
);

const pageLink = (page: SitePage): ChatLink => ({
  kind: 'page',
  slug: page.slug,
  title: page.title,
  path: page.path,
});

/**
 * Profile entries (P5-13), most general first so a question naming only the owner gets the
 * summary and their roles: the headline and intro, each role, each About paragraph, then the
 * personal section and each interest. The text is the owner's own first person, so each snippet
 * says whose words they are and who "I" is.
 */
function profileEntries(profile: Profile): Entry[] {
  const [aboutPage, experiencePage] = SITE_PAGES;
  const about = pageLink(aboutPage);
  const experience = pageLink(experiencePage);
  const firstName = profile.name.split(' ')[0] ?? profile.name;
  // The model speaks as the owner's dog, so the label says who "I" is in the owner's text.
  const words = `In ${firstName}'s words ("I" and "my" mean ${firstName}, not you)`;
  const entry = (
    link: ChatLink,
    heading: string,
    fields: readonly Field[],
    label: string,
    text: string,
  ): Entry => {
    // The marker closes the snippet, as on architecture notes, where the reference model copies
    // it far more often than from the header; the prose's words let a reply that drew on it link
    // the page even without the marker (`sourceFor`).
    const closing = `\nPage: ${linkMarker('page', link.slug)}`;
    const snippet = new SnippetBuilder(heading, closing.length)
      .prose(label, text)
      .close('Page', linkMarker('page', link.slug))
      .toString();
    // Compared with replies: only the prose the model saw, which a long entry cuts short.
    const shown = snippet
      .split('\n')
      .slice(1, -1)
      .join(' ')
      .slice(label.length + 2);
    return {
      link,
      fields,
      snippet,
      featured: false,
      noteTerms: new Set(searchTerms(shown)),
      profile: true,
    };
  };
  const personal = profile.personal;
  return [
    entry(
      about,
      `${profile.name}: ${profile.headline}`,
      [
        field(3, profile.name, profile.headline),
        field(2, PROFILE_WORDS.about),
        field(1, profile.intro),
      ],
      words,
      profile.intro,
    ),
    ...profile.experience.map((role) =>
      entry(
        experience,
        `${profile.name}, ${role.role} at ${role.organization} (${role.period})`,
        [
          field(3, role.role, role.organization),
          field(2, profile.name, PROFILE_WORDS.work),
          field(1, ...role.highlights),
        ],
        'Highlights',
        role.highlights.join(' '),
      ),
    ),
    ...profile.about.map((paragraph) =>
      entry(
        about,
        `About ${profile.name}`,
        [field(2, profile.name, PROFILE_WORDS.about), field(1, paragraph)],
        words,
        paragraph,
      ),
    ),
    ...(personal === undefined
      ? []
      : [
          entry(
            about,
            `${profile.name} outside work`,
            [field(2, profile.name, PROFILE_WORDS.personal), field(1, personal.intro)],
            words,
            personal.intro,
          ),
          ...personal.interests.map((interest) =>
            entry(
              about,
              `${profile.name}'s interest: ${interest.name}`,
              [
                field(3, interest.name, interestWordForms(interest.name)),
                field(2, profile.name, PROFILE_WORDS.personal),
                field(1, interest.description),
              ],
              words,
              interest.description,
            ),
          ),
        ]),
  ];
}

/** A reply draws on a note when it repeats at least this many of the note's words… */
const SOURCE_MIN_SHARED_TERMS = 4;
/** …and at least this share of them. */
const SOURCE_MIN_SHARED_RATIO = 0.5;

/**
 * Keyword retrieval over the project registry, the architecture notes, and the owner's profile,
 * held in memory: all ship with the API, so search needs no I/O and every replica answers
 * identically. Ranking is a
 * weighted term match (title and slug count most, then technologies, summary, and a note's
 * keywords, then descriptions and note text), scaled by how rare each term is across all entries.
 */
export class RegistryKnowledgeBase implements KnowledgeBase {
  private readonly entries: readonly Entry[];
  /** Links by name key, per kind and across kinds (projects, then mini-apps, then docs). */
  private readonly byKind: ReadonlyMap<string, ChatLink>;
  private readonly byName: ReadonlyMap<string, ChatLink>;
  /** The owner's name, as words that make a question about them. */
  private readonly ownerWords: ReadonlySet<string>;
  /** Inverse document frequency per term, computed once: the content never changes at runtime. */
  private readonly rarity: ReadonlyMap<string, number>;

  constructor(registry: ProjectRegistry, docs: DocNotes, profile?: Profile) {
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
    const docEntries = docs.notes.map((note): Entry => {
      const text = field(1, note.text);
      return {
        link: { kind: 'doc', slug: note.slug, title: note.title, path: docNoteUrl(note, docs) },
        fields: [field(3, note.title, note.slug), field(2, ...note.keywords), text],
        snippet: docSnippet(note),
        featured: false,
        noteTerms: text.terms,
      };
    });
    // Order matters: pages win a name shared across kinds, and earlier entries win score ties.
    this.entries = [
      ...projectEntries,
      ...miniAppEntries,
      ...docEntries,
      ...(profile === undefined ? [] : profileEntries(profile)),
    ];

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
    this.ownerWords = new Set(profile === undefined ? [] : rawWords(profile.name));

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
    return this.retrieve(query, limit).map(({ snippet }) => snippet);
  }

  sourceFor(query: string, limit: number, reply: string): ChatLink | undefined {
    const replyTerms = new Set(searchTerms(reply));
    for (const { link, noteTerms } of this.retrieve(query, limit)) {
      if (noteTerms === undefined || noteTerms.size === 0) continue;
      const shared = [...noteTerms].filter((term) => replyTerms.has(term)).length;
      if (shared >= SOURCE_MIN_SHARED_TERMS && shared / noteTerms.size >= SOURCE_MIN_SHARED_RATIO) {
        return link;
      }
    }
    return undefined;
  }

  resolve(name: string, kind?: ChatLinkKind): ChatLink | undefined {
    const key = nameKey(name);
    if (key === '') return undefined;
    return kind === undefined ? this.byName.get(key) : this.byKind.get(`${kind}:${key}`);
  }

  /** The entries `search` returns, best first: matches, or featured projects when none match. */
  private retrieve(query: string, limit: number): readonly Entry[] {
    if (limit <= 0) return [];
    const queryTerms = new Set(searchTerms(query));
    const aboutOwner = rawWords(query).some(
      (word) => PERSON_WORDS.has(word) || this.ownerWords.has(word),
    );
    const scored = this.entries
      .map((entry, index) => ({
        entry,
        index,
        score: entry.profile === true && !aboutOwner ? 0 : this.score(entry, queryTerms),
      }))
      .filter(({ score }) => score > 0)
      // Best first; registry order breaks ties so results are deterministic.
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const matches =
      scored.length > 0
        ? scored.map(({ entry }) => entry)
        : this.entries.filter((entry) => entry.featured);
    return matches.slice(0, limit);
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
