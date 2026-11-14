import type { ChatLink, ChatLinkKind } from '@portfolio/shared-types';
import type { KnowledgeBase } from './knowledge-base.js';

/** How a page is referenced in retrieved data, and the only way the model can suggest one. */
export const linkMarker = (kind: ChatLinkKind, slug: string) => `[[${kind}:${slug}]]`;

/** At most this many links accompany one reply. */
export const MAX_REPLY_LINKS = 3;

/**
 * Marker candidates. A closed `[[…]]` is classified by `classify()`. An unclosed `[[` counts only
 * when a `project:` or `mini-app:` token follows, and the candidate ends with that token, so the
 * prose after it survives. Any other `[[` (code such as `arr[[0]]` or `[[1, 2], [3, 4]]`) is not
 * a marker at all.
 */
const MARKER =
  /\[\[(?:([^[\]\n]{0,100})\]\]|[ \t]*((?:project|mini-app)[ \t]*:[ \t]*[a-z0-9-]*)\]?)/gi;
/** A `kind:` prefix, including made-up kinds such as `javascript:`. */
const KIND_PREFIX = /^([a-z][a-z0-9+.-]*)\s*:(.*)$/is;
/** Hyphenated like a slug (`made-up-project`): a marker attempt even without a kind. */
const SLUG_SHAPED = /^[a-z0-9]+(?:-[a-z0-9]+)+$/i;

/** Stands in for a removed marker until the gap it leaves is tidied (private-use code point). */
const GAP = '\uE000';
const GAPS = `${GAP}(?:[ \\t]*${GAP})*`;
const EMPTY_PARENS = new RegExp(`[ \\t]*\\(\\s*${GAPS}\\s*\\)`, 'g');
const EMPTY_LIST_ITEM = new RegExp(
  `^[ \\t]*(?:[-*•]|\\d+[.)])[ \\t]*${GAPS}[ \\t]*(?:\\n|$)`,
  'gm',
);
const GAP_BEFORE_PUNCTUATION = new RegExp(`[,;]?[ \\t]*${GAPS}[ \\t]*(?=[.,;:!?)]|$)`, 'gm');
const GAP_AFTER_SPACE = new RegExp(`(^|[ \\t])${GAPS}[ \\t]*`, 'gm');

const isLinkKind = (value: string): value is ChatLinkKind =>
  value === 'project' || value === 'mini-app';

export interface ResolvedReply {
  /** The reply with every marker replaced by its page title, or removed if it wasn't valid. */
  readonly reply: string;
  readonly links: readonly ChatLink[];
}

type Resolver = Pick<KnowledgeBase, 'resolve'>;

/**
 * What a closed `[[body]]` is: a link (by slug or title, with or without a kind), `drop` for an
 * empty marker, one naming a kind, or a slug-shaped one that doesn't resolve (so made-up slugs
 * never reach the visitor), or `keep` for bracketed text that isn't a marker at all.
 */
function classify(body: string, knowledge: Resolver): ChatLink | 'drop' | 'keep' {
  const trimmed = body.trim();
  if (trimmed === '') return 'drop';
  const prefixed = KIND_PREFIX.exec(trimmed);
  const kind = prefixed?.[1]?.toLowerCase();
  // An explicit kind is tried first: `[[mini-app:weather]]` is the mini-app even if a project
  // has a similar name.
  if (kind !== undefined && isLinkKind(kind)) {
    const ofKind = knowledge.resolve(prefixed?.[2] ?? '', kind);
    if (ofKind !== undefined) return ofKind;
  }
  // Then the whole text as a title of any kind ("Homelab: K3s Cluster", or a project titled
  // "Mini-App: Weather Dashboard").
  const titled = knowledge.resolve(trimmed);
  if (titled !== undefined) return titled;
  if (prefixed !== null) return 'drop';
  return SLUG_SHAPED.test(trimmed) ? 'drop' : 'keep';
}

/**
 * Closes the gaps removed markers left behind: "( )", an empty list item, a dangling separator,
 * doubled spaces. Only text next to a gap is touched, so the rest of the reply (code,
 * indentation) stays as written.
 */
const tidy = (text: string) =>
  text
    .replace(EMPTY_PARENS, '')
    .replace(EMPTY_LIST_ITEM, '')
    .replace(GAP_BEFORE_PUNCTUATION, '')
    .replace(GAP_AFTER_SPACE, '$1')
    .replaceAll(GAP, '')
    .trim();

/**
 * Turns the model's link markers into validated links. The model may only point at pages in the
 * registry, by slug or title; a marker naming anything else is dropped, so made-up slugs never
 * reach the client.
 */
export function resolveNavigationLinks(rawReply: string, knowledge: Resolver): ResolvedReply {
  const links = new Map<string, ChatLink>();
  const text = rawReply
    .replaceAll(GAP, '')
    .replace(MARKER, (marker: string, closed: string | undefined, unclosed: string | undefined) => {
      // An unclosed candidate always has a kind prefix, so it is never `keep`.
      const link = classify(closed ?? unclosed ?? '', knowledge);
      if (link === 'keep') return marker;
      if (link === 'drop') return GAP;
      const key = `${link.kind}:${link.slug}`;
      if (links.size < MAX_REPLY_LINKS || links.has(key)) links.set(key, link);
      return link.title;
    });
  return { reply: tidy(text), links: [...links.values()] };
}
