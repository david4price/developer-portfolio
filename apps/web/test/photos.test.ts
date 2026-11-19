import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import { profile } from '@portfolio/project-registry';
import sharp from 'sharp';

const photoFile = (name: string) =>
  fileURLToPath(new URL(`../../public/photos/${name}.webp`, import.meta.url));

it('ships every listed photo in both sizes, metadata-free and within budget', async () => {
  const photos = profile.personal?.photos ?? [];
  for (const photo of photos) {
    const large = await readFile(photoFile(`${photo.file}-lg`));
    const small = await readFile(photoFile(`${photo.file}-sm`));
    const [lg, sm] = await Promise.all([sharp(large).metadata(), sharp(small).metadata()]);

    // The page reserves space from these numbers, so they must be the large file's.
    assert.equal(lg.format, 'webp', photo.file);
    assert.deepEqual([lg.width, lg.height], [photo.width, photo.height], photo.file);
    assert.ok(Math.max(lg.width ?? 0, lg.height ?? 0) <= 1_800, `${photo.file}: large too big`);
    // The gallery size keeps the shape, at most 900 px on the long edge.
    assert.equal(sm.format, 'webp', photo.file);
    assert.ok(Math.max(sm.width ?? 0, sm.height ?? 0) <= 900, `${photo.file}: small too big`);
    const ratio = (w = 0, h = 1) => w / h;
    assert.ok(Math.abs(ratio(sm.width, sm.height) - ratio(lg.width, lg.height)) < 0.01, photo.file);

    // No camera, location, or editing metadata reaches the public site.
    for (const [size, meta] of [['lg', lg] as const, ['sm', sm] as const]) {
      assert.equal(meta.exif, undefined, `${photo.file}-${size} has EXIF`);
      assert.equal(meta.xmp, undefined, `${photo.file}-${size} has XMP`);
      assert.equal(meta.icc, undefined, `${photo.file}-${size} has an ICC profile`);
    }
    assert.ok(small.length < 160_000, `${photo.file}: gallery file over 160 KB`);
    assert.ok(large.length < 500_000, `${photo.file}: full-size file over 500 KB`);
  }
});
