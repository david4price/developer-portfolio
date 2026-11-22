import type { ComponentType } from 'react';
import { InfrastructureExplorerLoader } from './infrastructure-explorer/loader.tsx';
import { PortfolioAssistantNote } from './portfolio-assistant/page-note.tsx';
import type { MiniAppViewSlug } from './slugs.ts';
// new-project: web imports (pnpm new:project adds lines above this one)

/**
 * What `/apps/<slug>` renders below the title, by mini-app slug. Heavy apps export a loader built
 * with `next/dynamic`, so their code ships only on their own route. `pnpm new:project` adds new
 * entries here (P8-02).
 */
export const miniAppViews: Readonly<Record<string, ComponentType>> = {
  'infrastructure-explorer': InfrastructureExplorerLoader,
  'portfolio-assistant': PortfolioAssistantNote,
  // new-project: web views
} satisfies Record<MiniAppViewSlug, ComponentType>;
