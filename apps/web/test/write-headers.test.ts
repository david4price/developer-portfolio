import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildHeadersFile,
  type ExportedPage,
  MAX_LINE,
  MAX_RULES,
  urlPath,
} from '../scripts/write-headers.js';

const hash = (name: string) => `'sha256-${name}='`;
const page = (path: string, ...own: string[]): ExportedPage => ({
  path,
  scriptHashes: [hash('shared-a'), hash('shared-b'), ...own.map(hash)],
  notFound: path === '/404.html',
});

/** Rule path → its header lines, in file order. */
function rules(text: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const block of text.trim().split('\n\n')) {
    const [path = '', ...headers] = block.split('\n');
    result.set(path, headers);
  }
  return result;
}

const cspOf = (headers: readonly string[] = []) =>
  headers.find((line) => line.startsWith('  Content-Security-Policy:')) ?? '';

describe('urlPath', () => {
  it('maps exported files to the URLs Cloudflare serves them at', () => {
    assert.equal(urlPath('index.html'), '/');
    assert.equal(urlPath('about/index.html'), '/about/');
    assert.equal(urlPath('projects/example/index.html'), '/projects/example/');
    assert.equal(urlPath('404.html'), '/404.html');
  });
});

describe('buildHeadersFile', () => {
  const pages = [page('/', 'home'), page('/about/', 'about'), page('/404.html', 'not-found')];

  it('allows only shared and not-found hashes site-wide', () => {
    const csp = cspOf(rules(buildHeadersFile(pages, null).text).get('/*'));
    for (const name of ['shared-a', 'shared-b', 'not-found']) assert.ok(csp.includes(hash(name)));
    for (const name of ['home', 'about']) assert.ok(!csp.includes(hash(name)), name);
  });

  it('gives each page its own CSP and detaches the site-wide one first', () => {
    const file = buildHeadersFile(pages, 'https://api.example.com');
    const about = rules(file.text).get('/about/') ?? [];
    assert.equal(about[0], '  ! Content-Security-Policy', 'detach before setting');
    const csp = cspOf(about);
    for (const name of ['shared-a', 'shared-b', 'about']) assert.ok(csp.includes(hash(name)));
    assert.ok(!csp.includes(hash('home')), 'no other page’s scripts');
    assert.match(csp, /connect-src 'self' https:\/\/api\.example\.com/);
    assert.equal(file.pageRules, 2, 'the not-found page is covered by /*');
    assert.equal(file.rules, 4);
  });

  it('puts the site-wide rule first, so page rules can detach what it added', () => {
    const text = buildHeadersFile(pages, null).text;
    assert.ok(text.startsWith('/*\n'));
    assert.ok(text.indexOf('\n/about/\n') > text.indexOf('/_next/static/*'));
  });

  it('keeps every line short however many pages there are', () => {
    const many = Array.from({ length: MAX_RULES - 2 }, (_, index) =>
      page(`/p${index}/`, `${index}`),
    );
    const file = buildHeadersFile(many, null);
    assert.equal(file.rules, MAX_RULES);
    assert.ok(file.text.split('\n').every((line) => line.length <= MAX_LINE));
  });

  it('fails the build past Cloudflare’s rule limit', () => {
    const tooMany = Array.from({ length: MAX_RULES - 1 }, (_, index) =>
      page(`/p${index}/`, `${index}`),
    );
    assert.throws(() => buildHeadersFile(tooMany, null), /needs 101 rules \(limit 100\)/);
  });

  it('fails the build when one page’s policy outgrows a line', () => {
    const heavy = page(
      '/heavy/',
      ...Array.from({ length: 80 }, (_, index) => `x${index}`.repeat(10)),
    );
    assert.throws(
      () => buildHeadersFile([heavy, page('/')], null),
      /_headers line is \d+ characters/,
    );
  });
});

describe('write-headers as a script', () => {
  it('writes ../out/_headers when run directly, even through a symlink, ignoring arguments', () => {
    // A copy of the compiled script in a scripts/ + out/ layout, like apps/web.
    const work = mkdtempSync(join(tmpdir(), 'write-headers-'));
    try {
      const out = join(work, 'out');
      mkdirSync(out);
      mkdirSync(join(work, 'scripts'));
      writeFileSync(join(out, 'index.html'), '<html><script>self.x=1</script></html>');
      const script = join(work, 'scripts', 'write-headers.js');
      copyFileSync(resolve(import.meta.dirname, '../scripts/write-headers.js'), script);
      const link = join(work, 'linked-write-headers.js');
      symlinkSync(script, link);

      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.NEXT_PUBLIC_API_BASE_URL;
      for (const entry of [script, link]) {
        rmSync(join(out, '_headers'), { force: true });
        // Extra arguments, as pnpm appends them to `build`, must change nothing.
        const run = spawnSync(process.execPath, [entry, '--debug', '--out=elsewhere'], {
          encoding: 'utf8',
          env,
        });
        assert.equal(run.status, 0, run.stderr);
        const headers = readFileSync(join(out, '_headers'), 'utf8');
        assert.match(headers, /^\/\*\n {2}Content-Security-Policy: .*'sha256-/, entry);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
