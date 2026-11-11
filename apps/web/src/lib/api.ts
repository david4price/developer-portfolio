import { API_PREFIX } from '@portfolio/shared-types';

/**
 * Public API origin, inlined at build time. Unset means the site was built without an API, and
 * API-backed widgets render a "not configured" state instead of failing.
 */
export const apiBaseUrl: string | null =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') || null;

export function apiUrl(path: string): string | null {
  return apiBaseUrl === null ? null : `${apiBaseUrl}/${API_PREFIX}/${path.replace(/^\/+/, '')}`;
}
