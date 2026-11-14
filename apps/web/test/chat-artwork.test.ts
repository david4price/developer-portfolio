import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import sharp from 'sharp';

it('ships transparent, display-sized chat artwork within a small asset budget', async () => {
  for (const pose of ['lying-down', 'sitting', 'standing']) {
    const path = fileURLToPath(new URL(`../../public/dog-${pose}.webp`, import.meta.url));
    const data = await readFile(path);
    const metadata = await sharp(data).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.hasAlpha, true);
    assert.equal(Math.max(metadata.width ?? 0, metadata.height ?? 0), 256);
    assert.ok(data.length < 64_000, `${pose} exceeds the 64 KB artwork budget`);
  }
});
