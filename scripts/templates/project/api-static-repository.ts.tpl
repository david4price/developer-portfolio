import type { __Pascal__Item } from '@portfolio/shared-types';
import type { __Pascal__Repository } from './__slug__.repository.js';

const SAMPLE_ITEMS: readonly __Pascal__Item[] = [
  { id: 'first', name: 'First item', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'second', name: 'Second item', createdAt: '2026-01-02T00:00:00.000Z' },
];

/**
 * Fixed sample items, so the module works without a table. Replace it with a real adapter (see
 * the `db-migration` and `api-module` skills) when __title__ needs storage.
 */
export class Static__Pascal__Repository implements __Pascal__Repository {
  async list(limit: number): Promise<readonly __Pascal__Item[]> {
    return [...SAMPLE_ITEMS].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
}
