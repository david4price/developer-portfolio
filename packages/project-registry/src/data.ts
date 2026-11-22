import { miniApps } from './mini-apps/index.js';
import { projects } from './projects/index.js';
import type { RegistryInput } from './schema.js';

/**
 * Portfolio content, assembled from one file per project (`src/projects/`) and per mini-app
 * (`src/mini-apps/`). Replace or extend them with your own (`pnpm new:project` scaffolds both); the
 * registry is validated at import time, so a malformed entry fails the build and the tests.
 */
export const registryData: RegistryInput = {
  projects: [...projects],
  miniApps: [...miniApps],
};
