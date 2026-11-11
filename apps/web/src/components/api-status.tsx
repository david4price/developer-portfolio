'use client';

import { StatusBadge, type StatusTone } from '@portfolio/ui';
import { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api';

type ApiState = 'checking' | 'online' | 'unavailable' | 'not-configured';

const presentation: Record<ApiState, { tone: StatusTone; label: string }> = {
  checking: { tone: 'unknown', label: 'Checking API…' },
  online: { tone: 'positive', label: 'API online' },
  unavailable: { tone: 'warning', label: 'API unavailable — the site still works' },
  'not-configured': { tone: 'neutral', label: 'API not configured for this build' },
};

/**
 * Reports whether the homelab-hosted API is reachable. A failure here never affects the rest of
 * the page, which is fully static.
 */
export function ApiStatus() {
  const url = apiUrl('health');
  const [state, setState] = useState<ApiState>(url === null ? 'not-configured' : 'checking');

  useEffect(() => {
    if (url === null) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);

    fetch(url, { signal: controller.signal, credentials: 'omit' })
      .then((response) => {
        if (!cancelled) setState(response.ok ? 'online' : 'unavailable');
      })
      .catch(() => {
        // Network errors and the timeout both mean "unavailable"; an unmount means nothing.
        if (!cancelled) setState('unavailable');
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [url]);

  const { tone, label } = presentation[state];
  return <StatusBadge tone={tone} label={label} />;
}
