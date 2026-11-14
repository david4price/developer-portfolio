'use client';

import dynamic from 'next/dynamic';

/** The floating launcher loads the chat client only after its first activation. */
export const PortfolioAssistant = dynamic(
  () => import('./portfolio-assistant').then((module) => module.PortfolioChat),
  { loading: () => <p role="status">Loading chat…</p> },
);
