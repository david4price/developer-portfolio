/**
 * Writes `out/_headers` for Cloudflare Pages after `next build`.
 *
 * The static export inlines a few scripts into every page. Instead of allowing `'unsafe-inline'`,
 * this hashes each inline script in every exported HTML file and allows exactly those hashes, per
 * page (see "Layout" below). The build fails if a line or the rule count outgrows Cloudflare's
 * limits. The `_headers` builder is pure and exported for tests; the file I/O runs only when this
 * file is executed as a script.
 *
 * `connect-src` allows only this origin plus the API origin from NEXT_PUBLIC_API_BASE_URL (unset in
 * previews, so they can't call the production API).
 *
 * Cloudflare Web Analytics is the one third party: the edge injects its beacon script on the custom
 * domain, and the beacon reports page views and Web Vitals. Only its two exact hosts are allowed.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Layout.
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

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
/** Next.js's not-found page, which Cloudflare serves for unknown URLs. */
const NOT_FOUND = new Set(['/404.html', '/404/', '/_not-found/']);

function htmlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith('.html') ? [path] : [];
  });
}

function sha256(content: string): string {
  return `'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`;
}

function apiOrigin(): string | null {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!value) return null;
  const url = new URL(value);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL must use https (http only for localhost)');
  }
  return url.origin;
}

/**
 * Reads the export (`out/`, or `--out=<dir>` for tests) and writes its `_headers`. Only that exact
 * flag counts: other arguments pnpm appends to `build` are ignored, and nothing is read from the
 * environment that a stale export could leave behind.
 */
function main(): void {
  const outFlag = process.argv.slice(2).find((argument) => argument.startsWith('--out='));
  const outDir = resolve(outFlag?.slice('--out='.length) || resolve(import.meta.dirname, '../out'));
  // Same rule as next.config.ts: the workspace `.env` fills in only what the environment lacks.
  const workspaceEnv = resolve(import.meta.dirname, '../../../.env');
  if (existsSync(workspaceEnv)) process.loadEnvFile(workspaceEnv);

  const files = htmlFiles(outDir);
  if (files.length === 0) throw new Error(`No HTML files in ${outDir}; run next build first`);

  const pages: ExportedPage[] = files.map((file) => {
    const path = urlPath(relative(outDir, file));
    const scriptHashes = [...readFileSync(file, 'utf8').matchAll(INLINE_SCRIPT)].map((match) =>
      sha256(match[1] ?? ''),
    );
    return { path, scriptHashes, notFound: NOT_FOUND.has(path) };
  });

  const api = apiOrigin();
  const headers = buildHeadersFile(pages, api);
  writeFileSync(join(outDir, '_headers'), headers.text);
  console.log(
    `_headers: ${pages.length} pages, ${headers.rules} rules (${headers.pageRules} per-page CSPs); ` +
      `connect-src ${api ?? "'self' only"} (${relative(process.cwd(), join(outDir, '_headers'))})`,
  );
}

/**
 * Run as a script, not when imported by tests. Real paths are compared, so a symlinked checkout
 * or script still runs; `import.meta.main` isn't used because Node 24.0 and 24.1 (allowed by
 * `engines`) lack it. A skipped run would ship the site without security headers while the build
 * looked green, so `test/write-headers.test.ts` runs the compiled script through a symlink.
 */
const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  existsSync(invokedPath) &&
  realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
