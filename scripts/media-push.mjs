/**
 * Upload public/media to the R2 bucket that serves it in production.
 *
 * Shells out to wrangler rather than pulling in an S3 SDK: wrangler is already
 * the tool used to manage the Pages project, it handles auth through the same
 * login, and this saves the repo an AWS-shaped dependency for one operation
 * that runs by hand a few times a year.
 *
 * Only uploads what is missing or changed, so a re-run after adding one photo
 * transfers one photo.
 *
 * Prerequisites:
 *   npx wrangler login
 *   npx wrangler r2 bucket create pnw-explorer-media
 *   # then attach a custom domain to the bucket and set
 *   # PUBLIC_MEDIA_BASE=https://media.<your-domain> in the Pages project
 *
 * Usage:  node scripts/media-push.mjs [--bucket name] [--dry-run] [--force]
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const DRY = args.includes('--dry-run');
const FORCE = args.includes('--force');
const BUCKET = flag('bucket', process.env.R2_BUCKET || 'pnw-explorer-media');

const ROOT = path.resolve(import.meta.dirname, '..');
const MEDIA = path.join(ROOT, 'public/media');

if (!existsSync(MEDIA)) {
  console.error(`No media directory at ${MEDIA}`);
  process.exit(1);
}

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
};

/** Every file under public/media, as bucket-relative keys. */
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push({
      full,
      key: path.relative(MEDIA, full).split(path.sep).join('/'),
      size: statSync(full).size,
    });
  }
})(MEDIA);

const wrangler = (argv) =>
  execFileSync('npx', ['wrangler', ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Keys already in the bucket, so a re-run only moves what changed. */
let existing = new Set();
if (!FORCE) {
  try {
    const raw = wrangler(['r2', 'object', 'list', BUCKET, '--json']);
    const parsed = JSON.parse(raw);
    const objects = Array.isArray(parsed) ? parsed : (parsed.objects ?? []);
    existing = new Set(objects.map((o) => `${o.key}:${o.size}`));
  } catch {
    console.log('  (could not list the bucket — uploading everything)');
  }
}

const todo = files.filter((f) => FORCE || !existing.has(`${f.key}:${f.size}`));
const totalMb = (todo.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1);

console.log(`${files.length} local files, ${todo.length} to upload (${totalMb} MB) -> r2://${BUCKET}\n`);

if (DRY) {
  for (const f of todo.slice(0, 20)) console.log(`  would upload ${f.key}`);
  if (todo.length > 20) console.log(`  ...and ${todo.length - 20} more`);
  process.exit(0);
}

let done = 0;
let failed = 0;
for (const f of todo) {
  const ct = CONTENT_TYPES[path.extname(f.key).toLowerCase()] ?? 'application/octet-stream';
  try {
    wrangler([
      'r2', 'object', 'put', `${BUCKET}/${f.key}`,
      '--file', f.full,
      '--content-type', ct,
      // Media filenames are content-addressed by hand (a new photo gets a new
      // name), so a long immutable cache is safe and is the entire point of
      // moving these onto a CDN origin in the first place.
      '--cache-control', 'public, max-age=31536000, immutable',
    ]);
    done++;
    process.stdout.write(`\r  uploaded ${done}/${todo.length}`);
  } catch (err) {
    failed++;
    console.error(`\n  FAILED ${f.key}: ${String(err.stderr || err.message).trim().split('\n')[0]}`);
  }
}

console.log(`\n\n${done} uploaded, ${failed} failed.`);
if (!failed && done) {
  console.log(`\nSet PUBLIC_MEDIA_BASE to the bucket's public URL and redeploy.`);
}
process.exit(failed ? 1 : 0);
