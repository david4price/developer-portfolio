/**
 * Writes `out/_headers` for Cloudflare Pages after `next build`.
 *
 * The static export inlines a few bootstrap scripts into every page. Instead of allowing
 * `'unsafe-inline'`, this hashes each inline script in every exported HTML file and allows exactly
 * those hashes. The build fails if any inline script would be left uncovered or the policy grows
 * past what a `_headers` line can hold.
 *
 * `connect-src` allows only this origin plus the API origin from NEXT_PUBLIC_API_BASE_URL (unset in
 * previews, so they can't call the production API).
 *
 * Cloudflare Web Analytics is the one third party: the edge injects its beacon script on the custom
 * domain, and the beacon reports page views and Web Vitals. Only its two exact hosts are allowed.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const outDir = resolve(import.meta.dirname, '../out');
// Same rule as next.config.ts: the workspace `.env` fills in only what the environment lacks.
const workspaceEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(workspaceEnv)) process.loadEnvFile(workspaceEnv);

/** Cloudflare Pages limits each `_headers` line to 2,000 characters. */
const MAX_LINE = 2_000;
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
/** Cloudflare Web Analytics: the beacon script and the endpoint it reports to. */
const ANALYTICS_SCRIPT = 'https://static.cloudflareinsights.com';
const ANALYTICS_REPORT = 'https://cloudflareinsights.com';

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

const pages = htmlFiles(outDir);
if (pages.length === 0) throw new Error(`No HTML files in ${outDir}; run next build first`);

const hashes = new Set<string>();
for (const page of pages) {
  for (const match of readFileSync(page, 'utf8').matchAll(INLINE_SCRIPT)) {
    hashes.add(sha256(match[1] ?? ''));
  }
}

const api = apiOrigin();
const csp = [
  "default-src 'self'",
  `script-src 'self' ${ANALYTICS_SCRIPT} ${[...hashes].sort().join(' ')}`.trim(),
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${api ? ` ${api}` : ''} ${ANALYTICS_REPORT}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const headers = [
  '/*',
  `  Content-Security-Policy: ${csp}`,
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

const tooLong = headers.find((line) => line.length > MAX_LINE);
if (tooLong) {
  throw new Error(
    `A _headers line is ${tooLong.length} characters (limit ${MAX_LINE}); split the CSP per path`,
  );
}

writeFileSync(join(outDir, '_headers'), headers.join('\n'));
console.log(
  `_headers: ${hashes.size} inline script hashes from ${pages.length} pages; ` +
    `connect-src ${api ?? "'self' only"} (${relative(process.cwd(), join(outDir, '_headers'))})`,
);
