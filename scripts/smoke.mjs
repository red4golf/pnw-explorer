/**
 * Post-build smoke test.
 *
 * Asserts the things that break silently — the failures a green build and a
 * glance at the home page will not catch:
 *
 *   - a page shipped with no title, or a duplicated H1
 *   - the service worker missing, or precaching a route that does not exist
 *   - admin leaking into a public build
 *   - a hero image referenced but not deployed
 *   - the redirect file lost
 *
 * Runs against dist/, so it tests what would actually be served.
 *
 * Usage:  node scripts/smoke.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

if (!existsSync(DIST)) {
  console.error('No dist/ — run `npm run build` first.');
  process.exit(1);
}

let failures = 0;
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };
const pass = (msg) => console.log(`  ok    ${msg}`);

const htmlFiles = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'pagefind' || e.name === '_astro' || e.name === 'media') continue;
      walk(full);
    } else if (e.name.endsWith('.html')) htmlFiles.push(full);
  }
})(DIST);

console.log(`\nSmoke test over ${htmlFiles.length} pages\n`);

// --- Every page has a title, one H1, and a canonical ------------------------
const noTitle = [];
const badH1 = [];
const noCanonical = [];
const badCanonical = [];

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const rel = path.relative(DIST, file);

  if (!/<title>[^<]{3,}<\/title>/.test(html)) noTitle.push(rel);

  const h1s = html.match(/<h1[\s>]/g)?.length ?? 0;
  // The 404 page is allowed a single H1 like any other; zero is the bug.
  if (h1s !== 1) badH1.push(`${rel} (${h1s})`);

  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1];
  if (!canonical) noCanonical.push(rel);
  // A canonical must name the URL that is actually served. build.format 'file'
  // writes "/map.html" into Astro.url.pathname, but Cloudflare serves "/map"
  // and 308s the .html form — so a canonical carrying the extension points at
  // a redirect and disagrees with the sitemap.
  else if (/\.html(?:$|[?#])/.test(canonical)) badCanonical.push(`${rel} -> ${canonical}`);
}

noTitle.length ? fail(`${noTitle.length} page(s) without a title: ${noTitle.slice(0, 3).join(', ')}`)
  : pass('every page has a title');
badH1.length ? fail(`${badH1.length} page(s) without exactly one H1: ${badH1.slice(0, 3).join(', ')}`)
  : pass('every page has exactly one H1');
noCanonical.length ? fail(`${noCanonical.length} page(s) without a canonical link`)
  : pass('every page has a canonical link');
badCanonical.length
  ? fail(`${badCanonical.length} canonical(s) point at a .html URL that redirects: ${badCanonical.slice(0, 2).join(', ')}`)
  : pass('every canonical names the URL actually served');

// --- Third-party asset dependencies -----------------------------------------
// A stylesheet or script loaded from a CDN is a silent offline failure: the
// service worker only caches this origin, so the asset is simply missing in the
// field. It also broke the map once — Leaflet derives its marker imagePath from
// wherever leaflet.css was served, so a CDN stylesheet rewrote every pin URL to
// point at unpkg and all 95 pins 404'd. Bundle it, or it is not really shipped.
// GoatCounter is allowed: analytics is a progressive enhancement that is
// supposed to be absent offline.
const ASSET_HOST_ALLOWLIST = ['gc.zgo.at'];
const cdnAssets = new Set();
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const refs = [
    ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="(https?:\/\/[^"]+)"/g),
    ...html.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/g),
  ];
  for (const m of refs) {
    const host = new URL(m[1]).hostname;
    if (!ASSET_HOST_ALLOWLIST.includes(host)) cdnAssets.add(`${host} (${path.relative(DIST, file)})`);
  }
}
cdnAssets.size
  ? fail(`${cdnAssets.size} third-party asset dependency(ies): ${[...cdnAssets].slice(0, 3).join(', ')}`)
  : pass('no third-party stylesheets or scripts — everything works offline');

// --- Service worker ---------------------------------------------------------
const swPath = path.join(DIST, 'sw.js');
if (!existsSync(swPath)) {
  fail('sw.js is missing — offline support would silently not exist');
} else {
  const sw = readFileSync(swPath, 'utf8');
  const shell = JSON.parse(/const SHELL_URLS = (\[.*?\]);/s.exec(sw)?.[1] ?? '[]');
  if (!shell.length) fail('the service worker precaches nothing');
  else {
    // A precache list naming a route that does not exist is the classic way to
    // ship "offline support" that has never once worked.
    const missing = shell.filter((route) => {
      const candidates = route === '/'
        ? ['index.html']
        : [`${route.replace(/^\//, '')}.html`, path.join(route.replace(/^\//, ''), 'index.html'), route.replace(/^\//, '')];
      return !candidates.some((c) => existsSync(path.join(DIST, c)));
    });
    missing.length
      ? fail(`service worker precaches ${missing.length} route(s) that were not built: ${missing.join(', ')}`)
      : pass(`service worker precaches ${shell.length} routes, all present`);
  }
  if (!existsSync(path.join(DIST, 'sw-killswitch.js'))) fail('sw-killswitch.js was not emitted');
  else pass('legacy kill-switch emitted');
}

// --- Admin exposure ---------------------------------------------------------
const adminBuilt = existsSync(path.join(DIST, 'admin.html'));
if (adminBuilt && process.env.INCLUDE_ADMIN !== '1') {
  fail('admin.html is in the output but INCLUDE_ADMIN was not set');
} else if (adminBuilt) {
  const admin = readFileSync(path.join(DIST, 'admin.html'), 'utf8');
  /noindex/.test(admin) ? pass('admin built and marked noindex') : fail('admin is not marked noindex');
} else {
  pass('admin is absent from this build');
}

const robots = existsSync(path.join(DIST, 'robots.txt'))
  ? readFileSync(path.join(DIST, 'robots.txt'), 'utf8') : '';
/Disallow: \/admin/.test(robots) ? pass('robots.txt disallows /admin') : fail('robots.txt does not disallow /admin');

const sitemap = existsSync(path.join(DIST, 'sitemap-0.xml'))
  ? readFileSync(path.join(DIST, 'sitemap-0.xml'), 'utf8') : '';
/\/admin/.test(sitemap) ? fail('/admin appears in the sitemap') : pass('/admin is absent from the sitemap');

// --- Data and redirects -----------------------------------------------------
const locJson = path.join(DIST, 'locations.json');
if (!existsSync(locJson)) fail('locations.json is missing — the map has no data');
else {
  const data = JSON.parse(readFileSync(locJson, 'utf8'));
  const kb = (statSync(locJson).size / 1024).toFixed(0);
  if (!data.length) fail('locations.json is empty');
  else if (data.some((l) => typeof l.lat !== 'number' || typeof l.lng !== 'number')) {
    fail('locations.json has entries with non-numeric coordinates');
  } else pass(`locations.json: ${data.length} entries, ${kb} KB`);
}

existsSync(path.join(DIST, '_redirects'))
  ? pass('_redirects present (legacy URLs preserved)')
  : fail('_redirects is missing — legacy URLs would 404');

// --- Media referenced by built pages ---------------------------------------
const mediaBase = process.env.PUBLIC_MEDIA_BASE;
if (mediaBase) {
  pass(`media served remotely (${mediaBase}) — existence not checked here`);
} else {
  // Audio is gitignored by design: 58 MB of narration lives in R2, not in the
  // repo. So in a CI checkout the whole audio directory is legitimately absent,
  // and treating that as a broken reference would fail every build. An absent
  // DIRECTORY means "hosted elsewhere"; a present directory missing individual
  // FILES is a real defect and still fails.
  const audioShipped = existsSync(path.join(DIST, 'media/audio'));
  const missingMedia = new Set();
  let skippedAudio = 0;

  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    for (const m of html.matchAll(/(?:src|href)="(\/media\/[^"]+)"/g)) {
      const ref = decodeURIComponent(m[1]);
      if (!audioShipped && ref.startsWith('/media/audio/')) {
        skippedAudio++;
        continue;
      }
      if (!existsSync(path.join(DIST, ref))) missingMedia.add(ref);
    }
  }

  if (missingMedia.size) {
    fail(`${missingMedia.size} referenced media file(s) missing: ${[...missingMedia].slice(0, 3).join(', ')}`);
  } else {
    pass('every referenced media file is present');
  }
  if (skippedAudio) {
    console.log(`  note  ${skippedAudio} audio reference(s) not checked — no audio in this build, so it must be served from R2`);
    if (!mediaBase) {
      fail('audio is absent from the build AND PUBLIC_MEDIA_BASE is unset — narration would 404 in production');
    }
  }
}

console.log(failures ? `\n${failures} smoke test(s) failed.\n` : '\nAll smoke tests passed.\n');
process.exit(failures ? 1 : 0);
