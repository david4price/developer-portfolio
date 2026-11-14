import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Keep the supplied vector originals and render at twice the launcher's 128px display size.
const directory = new URL('../public/', import.meta.url);
for (const pose of ['lying-down', 'sitting', 'standing']) {
  const source = fileURLToPath(new URL(`dog-${pose}.svg`, directory));
  const destination = fileURLToPath(new URL(`dog-${pose}.webp`, directory));
  const result = await sharp(source)
    .resize({ width: 256, height: 256, fit: 'inside', kernel: 'nearest' })
    .webp({ lossless: true, effort: 6 })
    .toFile(destination);
  console.log(`dog-${pose}.webp: ${result.width}×${result.height}, ${result.size} bytes`);
}
