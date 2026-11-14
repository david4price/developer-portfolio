/**
 * Builds Cloudflare Pages `_headers` content from the exported pages. Pure: `write-headers.ts`
 * does the file I/O.
 *
 * Every page shares the Next.js bootstrap scripts, and each page also inlines one script of its
 * own (its RSC payload). One site-wide CSP listing every hash would outgrow a `_headers` line as
 * pages are added, so the CSP is split per path:
 *
 * - `/*` allows the shared hashes plus the not-found page's, because responses for unknown URLs
 *   match only `/*`.
 * - Each page with a script of its own gets a rule for its exact URL that detaches the `/*` CSP
 *   (`! Content-Security-Policy`) and sets one listing exactly that page's hashes. Without the
 *   detach, Cloudflare would join both values and the browser would enforce both policies.
 */

/** Cloudflare Pages limits: characters per `_headers` line, and rules per file. */
export const MAX_LINE = 2_000;
export const MAX_RULES = 100;

/** Cloudflare Web Analytics: the beacon script and the endpoint it reports to. */
const ANALYTICS_SCRIPT = 'https://static.cloudflareinsights.com';
const ANALYTICS_REPORT = 'https://cloudflareinsights.com';

export interface ExportedPage {
  /** The URL path the page is served at, such as `/` or `/projects/example/`. */
  readonly path: string;
  /** CSP source expressions (`'sha256-…'`) for the page's inline scripts. */
  readonly scriptHashes: readonly string[];
  /** Served for unknown URLs, which only the `/*` rule reaches. */
  readonly notFound: boolean;
}

export interface HeadersFile {
  readonly text: string;
  readonly rules: number;
  readonly pageRules: number;
}

/** `index.html` → `/`, `about/index.html` → `/about/`, `404.html` → `/404.html`. */
export function urlPath(relativeHtmlPath: string): string {
  const path = relativeHtmlPath.split('\\').join('/');
  if (path === 'index.html') return '/';
  if (path.endsWith('/index.html')) return `/${path.slice(0, -'index.html'.length)}`;
  return `/${path}`;
}

function contentSecurityPolicy(hashes: ReadonlySet<string>, apiOrigin: string | null): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${ANALYTICS_SCRIPT} ${[...hashes].sort().join(' ')}`.trim(),
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''} ${ANALYTICS_REPORT}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function buildHeadersFile(
  pages: readonly ExportedPage[],
  apiOrigin: string | null,
): HeadersFile {
  if (pages.length === 0) throw new Error('No exported pages');

  const pageHashes = pages.map((page) => new Set(page.scriptHashes));
  const shared = new Set(
    [...(pageHashes[0] ?? [])].filter((hash) => pageHashes.every((hashes) => hashes.has(hash))),
  );
  const siteWide = new Set(shared);
  pages.forEach((page, index) => {
    if (page.notFound) for (const hash of pageHashes[index] ?? []) siteWide.add(hash);
  });

  const lines = [
    '/*',
    `  Content-Security-Policy: ${contentSecurityPolicy(siteWide, apiOrigin)}`,
    // No includeSubDomains: other hosts under the domain may not all serve HTTPS.
    '  Strict-Transport-Security: max-age=31536000',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    '  Cross-Origin-Opener-Policy: same-origin',
    '',
    // Next.js fingerprints these files, so they never change under the same URL.
    '/_next/static/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ];

  let pageRules = 0;
  const ordered = pages
    .map((page, index) => ({ page, hashes: pageHashes[index] ?? new Set<string>() }))
    .sort((a, b) => a.page.path.localeCompare(b.page.path));
  for (const { page, hashes } of ordered) {
    if ([...hashes].every((hash) => siteWide.has(hash))) continue;
    // Rules apply in file order, so this detaches what `/*` added above.
    lines.push(
      page.path,
      '  ! Content-Security-Policy',
      `  Content-Security-Policy: ${contentSecurityPolicy(hashes, apiOrigin)}`,
      '',
    );
    pageRules += 1;
  }

  const tooLong = lines.find((line) => line.length > MAX_LINE);
  if (tooLong !== undefined) {
    throw new Error(
      `A _headers line is ${tooLong.length} characters (limit ${MAX_LINE}): ${tooLong.slice(0, 60)}…`,
    );
  }
  const rules = 2 + pageRules;
  if (rules > MAX_RULES) {
    throw new Error(
      `_headers needs ${rules} rules (limit ${MAX_RULES}); group pages by shared hashes or move ` +
        'inline scripts into files',
    );
  }
  return { text: lines.join('\n'), rules, pageRules };
}
