'use client';

import dynamic from 'next/dynamic';

/** Loads __title__ only on its own route, in the browser. */
export const __Pascal__Loader = dynamic(
  () => import('./__slug__.tsx').then((module) => module.__Pascal__),
  { ssr: false, loading: () => <p role="status">Loading…</p> },
);
