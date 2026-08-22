/**
 * Generate webp variants for every hero image.
 *
 * Three sizes, because three places use them at genuinely different dimensions:
 *   hero  1600w  the full-bleed image at the top of a location page
 *   card   480w  the grid card on listings, "nearby", and search
 *   thumb  240w  the map popup
 *
 * Serving the 1600px original into a 240px popup is the single most expensive
 * mistake a guide like this can make: it is used on phones, on mobile data, at
 * the exact moment the connection is worst.
 *
 * Idempotent — a variant newer than its source is left alone, so this is safe to
 * run on every build or after dropping in one new photo.
 *
 * Usage:  node scripts/optimize-images.mjs [--force]
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const FORCE = process.argv.includes('--force');
const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'public/media/images/locations');

const VARIANTS = [
  { suffix: 'hero', width: 1600, quality: 78 },
  { suffix: 'card', width: 480, quality: 74 },
  { suffix: 'thumb', width: 240, quality: 70 },
];

if (!existsSync(DIR)) {
  console.error(`No image directory at ${DIR}`);
  process.exit(1);
}

const sources = readdirSync(DIR).filter((f) => /\.(jpe?g|png)$/i.test(f));
let made = 0;
let skipped = 0;

for (const file of sources) {
  const src = path.join(DIR, file);
  const stem = file.replace(/\.(jpe?g|png)$/i, '');
  const srcTime = statSync(src).mtimeMs;

  for (const v of VARIANTS) {
    const out = path.join(DIR, `${stem}-${v.suffix}.webp`);
    if (!FORCE && existsSync(out) && statSync(out).mtimeMs >= srcTime) {
      skipped++;
      continue;
    }
    await sharp(src)
      // withoutEnlargement: a small source stays small rather than being
      // upscaled into a blurry file that is bigger than the original.
      .resize({ width: v.width, withoutEnlargement: true })
      .webp({ quality: v.quality })
      .toFile(out);
    made++;
  }
}

console.log(`images: ${sources.length} sources, ${made} variant(s) written, ${skipped} up to date`);
if (!sources.length) console.log('  (drop hero JPGs into public/media/images/locations first)');
