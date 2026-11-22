import type { MiniAppInput } from '../schema.js';
import { infrastructureExplorer } from './infrastructure-explorer.js';
import { portfolioAssistant } from './portfolio-assistant.js';
// new-project: mini-app imports (pnpm new:project adds lines above this one)

/** Every integrated mini-app, one file each in this folder (P8-02). */
export const miniApps: readonly MiniAppInput[] = [
  infrastructureExplorer,
  portfolioAssistant,
  // new-project: mini-apps
];
