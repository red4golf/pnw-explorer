/**
 * One-way import from the legacy PNWHistoricalExplorer repo.
 *
 * READ-ONLY with respect to the source. This script never writes to, moves, or
 * deletes anything in the legacy repo — it only copies out of it.
 *
 * It is not a dumb file copy. The new schema differs from the old one in four
 * ways that each need a real transform, and every transform that loses or
 * invents information is reported at the end rather than applied silently:
 *
 *   1. `description` split into `summary` (<=160, the meta tag) and `lead`
 *      (the long on-page paragraph). 79 of 95 legacy descriptions ran past the
 *      length search results will show.
 *   2. `heroImage` (a bare path) promoted to a `hero` object carrying alt text
 *      and attribution fields.
 *   3. Slugs normalised: five legacy slugs contain "---", which the new schema
 *      rejects. Old paths are written to a redirect map so no URL dies.
 *   4. The duplicate leading H1 is stripped from each body — the page template
 *      already renders the title, so every legacy page shipped two H1s.
 *
 * Usage:  node scripts/import-legacy.mjs [--source <path>] [--dry-run]
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, cpSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const DRY = args.includes('--dry-run');

const SOURCE = flag('source', 'C:/DEV/Projects/PNWHistoricalExplorer');
const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_CONTENT = path.join(SOURCE, 'src/content/locations');
const OUT_CONTENT = path.join(ROOT, 'content/locations');
const OUT_MEDIA = path.join(ROOT, 'public/media');

const report = { entries: 0, renamed: [], truncated: [], strippedH1: 0, factcheckFixed: [], noAlt: [], warnings: [] };

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

/** Collapse runs of hyphens; the legacy exporter emitted "---" for " - ". */
const normaliseSlug = (slug) =>
  slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

/**
 * Derive a <=160-char summary. Prefer whole sentences; fall back to a word
 * boundary only when a single sentence is already too long, and report every
 * such case so it can be hand-written later.
 */
function deriveSummary(description, slug) {
  const text = description.trim().replace(/\s+/g, ' ');
  if (text.length >= 70 && text.length <= 160) return { summary: text, lead: null };

  const sentences = splitSentences(text);
  let summary = '';
  for (const s of sentences) {
    const candidate = summary ? `${summary} ${s}` : s;
    if (candidate.length > 160) break;
    summary = candidate;
    if (summary.length >= 70) break;
  }

  if (summary.length < 70 || summary.length > 160) {
    // No clean sentence boundary fits. Cut at a word boundary and flag it.
    const cut = text.slice(0, 157);
    summary = `${cut.slice(0, cut.lastIndexOf(' '))}…`;
    report.truncated.push(slug);
  }

  const lead = text.length > summary.replace(/…$/, '').length ? text : null;
  return { summary, lead };
}

/**
 * Promote a bare image path to the attributed `hero` object.
 *
 * Alt text cannot be invented from a path, so it is seeded from the title and
 * the entry is listed under "needs alt text" in the report. The admin pipeline
 * board flags the same condition (alt that merely restates the title) so this
 * stays visible after the migration instead of quietly becoming permanent.
 */
function buildHero(heroImage, title, category, slug) {
  if (!heroImage) return null;
  report.noAlt.push(slug);
  return {
    src: heroImage,
    alt: `${title} — ${category.toLowerCase()} site in the Pacific Northwest`,
    credit: null,
    source: null,
    // Provenance did not survive the original Replit export. "unknown" is the
    // honest value; claiming public-domain here would be a licence assertion
    // nobody has actually checked.
    license: 'unknown',
  };
}

/** Coerce a legacy factcheck record into one the new refinements will accept. */
function normaliseFactcheck(fc, slug) {
  if (!fc || typeof fc !== 'object') return undefined;
  const out = { ...fc };
  const fixes = [];

  if (typeof out.claimsCited === 'number' && typeof out.claimsTotal === 'number' && out.claimsCited > out.claimsTotal) {
    out.claimsTotal = out.claimsCited;
    fixes.push('claimsTotal raised to claimsCited');
  }
  if (out.status && out.status !== 'unverified' && !out.lastChecked) {
    out.status = 'unverified';
    fixes.push('status reset to unverified (no lastChecked date)');
  }
  if (['verified', 'corrected'].includes(out.status) && (!out.sourceTier || out.sourceTier === 'none')) {
    out.status = 'in-review';
    fixes.push('status downgraded to in-review (no source tier recorded)');
  }
  if (fixes.length) report.factcheckFixed.push({ slug, fixes });
  return out;
}

/**
 * Strip the leading H1. The template renders the title in the page hero, so
 * keeping the body's own H1 shipped two on every page — an accessibility defect
 * and a duplicated signal to search engines.
 */
function stripLeadingH1(body) {
  const stripped = body.replace(/^\s*#\s+[^\n]+\n+/, '');
  if (stripped !== body) report.strippedH1++;
  return stripped;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (!existsSync(SRC_CONTENT)) {
  console.error(`Legacy content not found at ${SRC_CONTENT}`);
  console.error('Pass --source <path to PNWHistoricalExplorer>');
  process.exit(1);
}

mkdirSync(OUT_CONTENT, { recursive: true });

const files = readdirSync(SRC_CONTENT).filter((f) => f.endsWith('.md'));
const redirects = [];

for (const file of files) {
  const raw = readFileSync(path.join(SRC_CONTENT, file), 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) {
    report.warnings.push(`${file}: no frontmatter, skipped`);
    continue;
  }

  let fm;
  try {
    fm = parseYaml(m[1]);
  } catch (err) {
    report.warnings.push(`${file}: unparseable frontmatter (${err.message}), skipped`);
    continue;
  }

  const body = stripLeadingH1(m[2].replace(/\r\n/g, '\n').trim());
  const oldSlug = fm.slug ?? path.basename(file, '.md');
  const slug = normaliseSlug(oldSlug);
  if (slug !== oldSlug) {
    report.renamed.push({ from: oldSlug, to: slug });
    redirects.push(`/locations/${oldSlug} /locations/${slug} 301`);
  }

  const { summary, lead } = deriveSummary(fm.description ?? '', slug);

  // Field order here is the field order in the written file. Identity first,
  // then place, then editorial state — so a human opening the file in the CMS
  // or in git sees the same shape every time.
  const out = {
    title: fm.title,
    slug,
    category: fm.category,
    period: fm.period ?? null,
    address: fm.address ?? null,
    coordinates: { lat: fm.coordinates?.lat, lng: fm.coordinates?.lng },
    summary,
    lead,
    notice: Array.isArray(fm.notice) && fm.notice.length >= 2 ? fm.notice : null,
    hero: buildHero(fm.heroImage, fm.title, fm.category, slug),
    audio: fm.audio ?? null,
    draft: fm.draft ?? false,
    publishDate: fm.publishDate ?? null,
    books: (fm.books ?? []).map((b) => ({
      title: b.title,
      author: b.author ?? null,
      url: b.url ?? null,
      isbn: b.isbn ?? null,
    })),
    sourceId: fm.sourceId ?? null,
    mergedFrom: Array.isArray(fm.mergedFrom)
      ? fm.mergedFrom.map((x) => ({ id: x.id, name: x.name }))
      : null,
  };

  const fc = normaliseFactcheck(fm.factcheck, slug);
  if (fc) out.factcheck = fc;

  const yamlText = stringifyYaml(out, { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' });
  const contents = `---\n${yamlText}---\n\n${body}\n`;

  if (!DRY) writeFileSync(path.join(OUT_CONTENT, `${slug}.md`), contents, 'utf8');
  report.entries++;
}

// --- Media ------------------------------------------------------------------
// Copied, never moved. The legacy repo keeps its own copy untouched.
if (!DRY) {
  for (const [from, to] of [
    [path.join(SOURCE, 'public/images'), path.join(OUT_MEDIA, 'images')],
    [path.join(SOURCE, 'public/audio'), path.join(OUT_MEDIA, 'audio')],
  ]) {
    if (existsSync(from)) {
      mkdirSync(to, { recursive: true });
      cpSync(from, to, { recursive: true });
    } else {
      report.warnings.push(`media source missing: ${from}`);
    }
  }
}

// --- Redirects --------------------------------------------------------------
// Cloudflare Pages reads public/_redirects. Two jobs: the five normalised slugs,
// and the whole legacy /PNWHistoricalExplorer/* subpath, so links published
// against the GitHub Pages URL keep resolving after the move to a root domain.
if (!DRY) {
  const lines = [
    '# Generated by scripts/import-legacy.mjs — do not hand-edit.',
    '# Legacy GitHub Pages subpath.',
    '/PNWHistoricalExplorer/* /:splat 301',
    '',
    '# Slugs normalised during the migration (legacy exporter emitted "---").',
    ...redirects,
    '',
  ];
  mkdirSync(path.join(ROOT, 'public'), { recursive: true });
  writeFileSync(path.join(ROOT, 'public/_redirects'), lines.join('\n'), 'utf8');
}

// --- Report -----------------------------------------------------------------
const dirSize = (dir) => {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else total += statSync(p).size;
    }
  };
  walk(dir);
  return total;
};
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

console.log(`\n${DRY ? '[dry run] ' : ''}Imported ${report.entries} entries from ${SOURCE}`);
console.log(`  duplicate H1 stripped:     ${report.strippedH1}`);
console.log(`  slugs normalised:          ${report.renamed.length}`);
for (const r of report.renamed) console.log(`      ${r.from}  ->  ${r.to}`);
console.log(`  summaries truncated:       ${report.truncated.length}  (need a hand-written summary)`);
for (const s of report.truncated.slice(0, 10)) console.log(`      ${s}`);
if (report.truncated.length > 10) console.log(`      ...and ${report.truncated.length - 10} more`);
console.log(`  factcheck records coerced: ${report.factcheckFixed.length}`);
for (const f of report.factcheckFixed) console.log(`      ${f.slug}: ${f.fixes.join('; ')}`);
console.log(`  heroes needing real alt:   ${report.noAlt.length}`);
if (!DRY) {
  console.log(`  media copied:              images ${mb(dirSize(path.join(OUT_MEDIA, 'images')))}, audio ${mb(dirSize(path.join(OUT_MEDIA, 'audio')))}`);
}
for (const w of report.warnings) console.log(`  WARNING: ${w}`);
console.log('');
