import type { ChatLink, ChatLinkKind } from '@portfolio/shared-types';

export const KNOWLEDGE_BASE = Symbol('KNOWLEDGE_BASE');

/**
 * Approved portfolio content the assistant answers from. Implementations hold only
 * repository-reviewed content (today the project registry and architecture notes), never visitor
 * input, so a swap to another retrieval method (e.g. vectors, if measured answer quality ever needs
 * it) stays local.
 */
export interface KnowledgeBase {
  /**
   * Prompt-ready snippets for `query`, best match first, at most `limit`. Falls back to featured
   * projects when nothing matches, so general questions still get grounding.
   */
  search(query: string, limit: number): readonly string[];

  /**
   * The architecture note `reply` draws on: among the notes `search(query, limit)` returned, the
   * best-ranked one whose words the reply largely repeats; `undefined` if none. Lets the source
   * be linked even when the model leaves out the note's marker.
   */
  sourceFor(query: string, limit: number, reply: string): ChatLink | undefined;

  /**
   * The link for a registry item or architecture note named by slug or title (case, spacing, and punctuation
   * ignored), limited to `kind` when given; `undefined` if no such item exists.
   */
  resolve(name: string, kind?: ChatLinkKind): ChatLink | undefined;
}
