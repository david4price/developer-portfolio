/**
 * Mini-apps with a view on `/apps/<slug>` (see `index.ts`, which must map exactly these). Kept
 * apart from the views so tests can check it against the registry without loading React or Next.
 * `pnpm new:project` adds new slugs here (P8-02).
 */
export const miniAppViewSlugs = [
  'infrastructure-explorer',
  'portfolio-assistant',
  // new-project: view slugs
] as const;

export type MiniAppViewSlug = (typeof miniAppViewSlugs)[number];
