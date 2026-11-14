import type { ChatLink, ChatLinkKind } from '@portfolio/shared-types';

export const KNOWLEDGE_BASE = Symbol('KNOWLEDGE_BASE');

/**
 * Approved portfolio content the assistant answers from. Implementations hold only
 * repository-reviewed content (today the project registry), never visitor input, so a swap to
 * another retrieval method (e.g. vectors, if measured answer quality ever needs it) stays local.
 */
export interface KnowledgeBase {
  /**
   * Prompt-ready snippets for `query`, best match first, at most `limit`. Falls back to featured
   * projects when nothing matches, so general questions still get grounding.
   */
  search(query: string, limit: number): readonly string[];

  /**
   * The page link for a registry item named by slug or title (case, spacing, and punctuation
   * ignored), limited to `kind` when given; `undefined` if no such item exists.
   */
  resolve(name: string, kind?: ChatLinkKind): ChatLink | undefined;
}
