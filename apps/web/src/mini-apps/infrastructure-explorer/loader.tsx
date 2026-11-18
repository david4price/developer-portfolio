'use client';

import dynamic from 'next/dynamic';

/**
 * Loads the explorer only on its own route, and only in the browser: it renders times relative to
 * now, which a build-time render would freeze.
 */
export const InfrastructureExplorerLoader = dynamic(
  () => import('./infrastructure-explorer').then((module) => module.InfrastructureExplorer),
  { ssr: false, loading: () => <p role="status">Loading the infrastructure map…</p> },
);
