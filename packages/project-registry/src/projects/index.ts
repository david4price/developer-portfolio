import type { ProjectInput } from '../schema.js';
import { developerPortfolio } from './developer-portfolio.js';
// new-project: project imports (pnpm new:project adds lines above this one)

/**
 * Every project, one file each in this folder; featured projects first. `pnpm new:project` adds
 * new ones here (P8-02).
 */
export const projects: readonly ProjectInput[] = [
  developerPortfolio,
  // new-project: projects
];
