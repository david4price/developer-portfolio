import type { __Pascal__Item } from '@portfolio/shared-types';

export const __CONST___REPOSITORY = Symbol('__CONST___REPOSITORY');

/** Where __title__ keeps its items. The controller depends only on this port. */
export interface __Pascal__Repository {
  /** Newest first, at most `limit`. */
  list(limit: number): Promise<readonly __Pascal__Item[]>;
}
