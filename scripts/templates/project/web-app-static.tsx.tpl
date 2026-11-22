'use client';

import { useState } from 'react';

/**
 * __title__: the starting point created by `pnpm new:project`. Build the app here; keep heavy
 * dependencies inside this folder so they load only on this route.
 */
export function __Pascal__() {
  const [clicks, setClicks] = useState(0);
  return (
    <section aria-label={__titleJson__}>
      <p>This mini-app is ready to build. Its code lives in this folder.</p>
      <button type="button" onClick={() => setClicks((count) => count + 1)}>
        Clicked {clicks} {clicks === 1 ? 'time' : 'times'}
      </button>
    </section>
  );
}
