import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'node:test';

/** Next.js turns these files into the site's favicon links (file-based metadata). */
const appFile = (name: string) => readFileSync(resolve(process.cwd(), 'src/app', name));

/** Width, height, and colour type from a PNG's IHDR chunk. */
function pngHeader(png: Buffer) {
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

it('ships the favicon set: a multi-size .ico, a 192 px icon, and a 180 px Apple icon', () => {
  const ico = appFile('favicon.ico');
  assert.equal(ico.readUInt16LE(2), 1, 'an icon file');
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16] || 256);
  assert.deepEqual(
    sizes.sort((a, b) => a - b),
    [16, 32, 48],
  );
  assert.deepEqual(pngHeader(appFile('icon.png')), { width: 192, height: 192 });
  assert.deepEqual(pngHeader(appFile('apple-icon.png')), { width: 180, height: 180 });
});

it('keeps the icons small', () => {
  for (const name of ['favicon.ico', 'icon.png', 'apple-icon.png']) {
    assert.ok(appFile(name).length < 16_000, `${name} is ${appFile(name).length} bytes`);
  }
});
