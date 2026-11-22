'use client';

import type { __Pascal__ItemsResponse } from '@portfolio/shared-types';
import { useEffect, useState } from 'react';
import { apiUrl } from '../../lib/api.ts';

type State =
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly response: __Pascal__ItemsResponse };

/**
 * __title__: the starting point created by `pnpm new:project`. It lists the items its API module
 * serves (`GET /api/v1/__slug__/items`) and says so plainly when the API isn't there.
 */
export function __Pascal__() {
  const url = apiUrl('__slug__/items');
  const [state, setState] = useState<State>(
    url === null ? { kind: 'not-configured' } : { kind: 'loading' },
  );

  useEffect(() => {
    if (url === null) return;
    let unmounted = false;
    const controller = new AbortController();
    // A hanging API shows as unavailable, not as loading forever.
    const timeout = setTimeout(() => controller.abort(), 8_000);
    fetch(url, { signal: controller.signal, credentials: 'omit' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as __Pascal__ItemsResponse;
        if (!unmounted) setState({ kind: 'ready', response: body });
      })
      .catch(() => {
        if (!unmounted) setState({ kind: 'unavailable' });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      unmounted = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [url]);

  if (state.kind === 'not-configured') return <p>This build has no API configured.</p>;
  if (state.kind === 'loading') return <p role="status">Loading…</p>;
  if (state.kind === 'unavailable') return <p role="status">The API is unavailable right now.</p>;
  if (state.response.items.length === 0) return <p>No items yet.</p>;
  return (
    <ul aria-label={__titleJson__}>
      {state.response.items.map((item) => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  );
}
