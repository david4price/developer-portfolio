/**
 * Writes `out/_headers` for Cloudflare Pages after `next build`.
 *
 * The static export inlines a few scripts into every page. Instead of allowing `'unsafe-inline'`,
 * this hashes each inline script in every exported HTML file and allows exactly those hashes, per
 * page (`headers-file.ts` explains the layout). The build fails if a line or the rule count
 * outgrows Cloudflare's limits.
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
import { buildHeadersFile, type ExportedPage, urlPath } from './headers-file.ts';

const outDir = resolve(import.meta.dirname, '../out');
// Same rule as next.config.ts: the workspace `.env` fills in only what the environment lacks.
const workspaceEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(workspaceEnv)) process.loadEnvFile(workspaceEnv);

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
