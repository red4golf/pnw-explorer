/**
 * Check every outbound link in the corpus.
 *
 * Kept OUT of the default `npm run check` and out of the merge gate on purpose:
 * it makes real network requests, so it is slow and it fails for reasons that
 * have nothing to do with the change under review. Run it on a schedule instead
 * — a weekly cron, or by hand before a push.
 *
 * The reason it exists at all: there are ~160 Amazon book links across the
 * corpus, every one of them is a monetised outbound link, and a dead one is
 * revenue quietly draining away somewhere nobody looks. Link rot is invisible
 * until you go looking for it.
 *
 * Usage:  node scripts/check-links.mjs [--concurrency 6] [--timeout 15000]
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { splitFrontmatter } from '../src/lib/style.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const CONCURRENCY = arg('concurrency', 6);
const TIMEOUT = arg('timeout', 15000);

const ROOT = path.resolve(import.meta.dirname, '..');
const CONTENT = path.join(ROOT, 'content/locations');

/** Collect every external URL, remembering which entries reference it. */
const urls = new Map();
const add = (url, slug, kind) => {
  if (!/^https?:\/\//i.test(url)) return;
  if (!urls.has(url)) urls.set(url, { refs: [], kind });
  urls.get(url).refs.push(slug);
};

for (const file of readdirSync(CONTENT).filter((f) => f.endsWith('.md'))) {
  const raw = readFileSync(path.join(CONTENT, file), 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  const data = parseYaml(frontmatter) ?? {};
  const slug = data.slug ?? path.basename(file, '.md');

  for (const b of data.books ?? []) if (b.url) add(b.url, slug, 'book');
  if (data.hero?.source) add(data.hero.source, slug, 'image-source');
  for (const m of body.matchAll(/\]\(\s*(https?:\/\/[^)\s]+)/g)) add(m[1], slug, 'body');
}

console.log(`Checking ${urls.size} unique URLs from ${readdirSync(CONTENT).length} entries…\n`);

/**
 * HEAD first, GET on failure.
 *
 * Amazon and several archive hosts reject or misreport HEAD while serving GET
 * perfectly well, so a HEAD-only checker reports a wall of false failures on
 * precisely the links that matter most here.
 */
async function check(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT),
        headers: {
          'User-Agent': 'pnw-explorer-linkcheck/1.0 (+https://pnwhistoricalexplorer.com)',
          Accept: '*/*',
        },
      });
      if (res.ok) return { ok: true, status: res.status, finalUrl: res.url };
      if (method === 'GET') return { ok: false, status: res.status, finalUrl: res.url };
    } catch (err) {
      if (method === 'GET') return { ok: false, status: 0, error: err.message };
    }
  }
  return { ok: false, status: 0, error: 'unreachable' };
}

const entries = [...urls.entries()];
const results = [];
for (let i = 0; i < entries.length; i += CONCURRENCY) {
  const batch = entries.slice(i, i + CONCURRENCY);
  const settled = await Promise.all(
    batch.map(async ([url, meta]) => ({ url, meta, res: await check(url) }))
  );
  results.push(...settled);
  process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, entries.length)}/${entries.length}`);
}
process.stdout.write('\n\n');

const broken = results.filter((r) => !r.res.ok);
const ok = results.length - broken.length;

for (const b of broken) {
  console.log(`  BROKEN ${b.res.status || b.res.error}  ${b.url}`);
  console.log(`         ${b.meta.kind} · referenced by: ${b.meta.refs.join(', ')}`);
}

// An Amazon link that redirects away from a product page is usually a delisted
// item: it still returns 200, so a status check alone will never catch it.
const suspicious = results.filter(
  (r) =>
    r.res.ok &&
    /amazon\./i.test(r.url) &&
    r.res.finalUrl &&
    !/\/dp\/|\/gp\/product\//.test(r.res.finalUrl)
);
if (suspicious.length) {
  console.log(`\n  ${suspicious.length} Amazon link(s) resolve somewhere other than a product page:`);
  for (const s of suspicious) console.log(`    ${s.url}\n      -> ${s.res.finalUrl}`);
}

console.log(`\n${ok} ok, ${broken.length} broken, ${suspicious.length} suspicious.\n`);
process.exit(broken.length ? 1 : 0);
