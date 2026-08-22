/**
 * Content gate. Runs in CI before merge and locally on demand.
 *
 * Three checks: prose style, coordinate sanity, frontmatter shape.
 *
 * --- The ratchet ------------------------------------------------------------
 *
 * The style standard is strict enough that most of the inherited corpus fails
 * it. A gate that fails 80 of 95 entries on day one is a gate somebody disables
 * in week two, and then the standard is a document again instead of a rule.
 *
 * So the default mode is a RATCHET, not a wall. content/.style-baseline.json
 * records the error count each entry currently carries. The build fails only if
 * an entry gets WORSE than its baseline, or if a NEW entry arrives carrying any
 * errors at all. Existing debt is frozen and visible; new debt is impossible.
 * Every rewrite lowers a number, and `--update-baseline` locks the improvement
 * in so it can never regress.
 *
 * `--strict` ignores the baseline and demands the full standard. That is what
 * the corpus should eventually pass, and what a single entry can be held to
 * today: `--strict --only=style --filter=port-madison`.
 *
 * Usage:
 *   node scripts/check.mjs
 *   node scripts/check.mjs --strict
 *   node scripts/check.mjs --only=style --filter=port-madison --verbose
 *   node scripts/check.mjs --update-baseline
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { analyse, corpusChecks, splitFrontmatter } from '../src/lib/style.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const val = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const STRICT = has('strict');
const VERBOSE = has('verbose');
const UPDATE_BASELINE = has('update-baseline');
const ONLY = val('only');
const FILTER = val('filter');

const ROOT = path.resolve(import.meta.dirname, '..');
const CONTENT = path.join(ROOT, 'content/locations');
const BASELINE_PATH = path.join(ROOT, 'content/.style-baseline.json');

const BOUNDS = { lat: [36, 56], lng: [-126, -110] };
const REQUIRED_KEYS = ['title', 'slug', 'category', 'coordinates', 'summary'];

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

if (!existsSync(CONTENT)) {
  console.error(`No content at ${CONTENT}. Run: npm run import:legacy`);
  process.exit(1);
}

const entries = [];
for (const file of readdirSync(CONTENT).filter((f) => f.endsWith('.md'))) {
  const raw = readFileSync(path.join(CONTENT, file), 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  let data = {};
  let parseError = null;
  try {
    data = parseYaml(frontmatter) ?? {};
  } catch (err) {
    parseError = err.message;
  }
  const slug = data.slug ?? path.basename(file, '.md');
  if (FILTER && !slug.includes(FILTER)) continue;
  entries.push({ file, slug, data, body, parseError });
}

if (!entries.length) {
  console.error(FILTER ? `No entries matched --filter=${FILTER}` : 'No entries found.');
  process.exit(1);
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : { generated: null, entries: {} };

const runStyle = !ONLY || ONLY === 'style';
const runCoords = !ONLY || ONLY === 'coords';
const runSchema = !ONLY || ONLY === 'schema';

let failures = 0;
const styleResults = [];

// ---------------------------------------------------------------------------
// Frontmatter shape
// ---------------------------------------------------------------------------

if (runSchema) {
  console.log(c.bold('\nFrontmatter'));
  let problems = 0;
  const seenSlugs = new Map();

  for (const e of entries) {
    const issues = [];
    if (e.parseError) issues.push(`unparseable YAML: ${e.parseError}`);

    for (const key of REQUIRED_KEYS) {
      if (e.data[key] === undefined || e.data[key] === null) issues.push(`missing "${key}"`);
    }
    if (e.data.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.data.slug)) {
      issues.push(`slug "${e.data.slug}" is not lowercase-hyphen`);
    }
    if (e.data.slug && path.basename(e.file, '.md') !== e.data.slug) {
      issues.push(`filename does not match slug "${e.data.slug}"`);
    }
    if (typeof e.data.summary === 'string') {
      const n = e.data.summary.length;
      if (n < 70 || n > 160) issues.push(`summary is ${n} chars (needs 70-160)`);
    }
    if (e.data.hero && !e.data.hero.alt) issues.push('hero has no alt text');
    if (e.data.slug) {
      if (seenSlugs.has(e.data.slug)) issues.push(`duplicate slug, also in ${seenSlugs.get(e.data.slug)}`);
      seenSlugs.set(e.data.slug, e.file);
    }

    if (issues.length) {
      problems++;
      console.log(`  ${c.red('x')} ${e.slug}`);
      for (const i of issues) console.log(`      ${i}`);
    }
  }
  // Frontmatter problems always fail: these are structural, not stylistic, and
  // `astro build` would reject them anyway — better to say so here with a
  // readable message than to let Zod report it mid-build.
  failures += problems;
  console.log(problems ? c.red(`  ${problems} entr${problems === 1 ? 'y' : 'ies'} with frontmatter problems`) : c.green('  all frontmatter valid'));
}

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

if (runCoords) {
  console.log(c.bold('\nCoordinates'));
  let problems = 0;
  const byPosition = new Map();

  for (const e of entries) {
    const co = e.data.coordinates;
    const issues = [];
    if (!co || typeof co.lat !== 'number' || typeof co.lng !== 'number') {
      issues.push('missing or non-numeric coordinates');
    } else {
      if (co.lat < BOUNDS.lat[0] || co.lat > BOUNDS.lat[1]) {
        issues.push(`lat ${co.lat} outside ${BOUNDS.lat.join('..')}`);
      }
      if (co.lng < BOUNDS.lng[0] || co.lng > BOUNDS.lng[1]) {
        issues.push(`lng ${co.lng} outside ${BOUNDS.lng.join('..')} (western longitudes are negative)`);
      }
      // Two entries at the identical point is nearly always a copy-paste, not
      // two real places sharing a GPS fix to six decimals.
      const key = `${co.lat.toFixed(5)},${co.lng.toFixed(5)}`;
      if (byPosition.has(key)) issues.push(`identical coordinates to ${byPosition.get(key)}`);
      else byPosition.set(key, e.slug);
    }
    if (issues.length) {
      problems++;
      console.log(`  ${c.red('x')} ${e.slug}`);
      for (const i of issues) console.log(`      ${i}`);
    }
  }
  failures += problems;
  console.log(problems ? c.red(`  ${problems} coordinate problem(s)`) : c.green(`  all ${entries.length} coordinates plausible`));
}

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

if (runStyle) {
  console.log(c.bold(`\nProse style${STRICT ? ' (strict — full standard)' : ' (ratchet — no new debt)'}`));

  for (const e of entries) {
    const result = analyse(e.body, { hasFactcheck: Boolean(e.data.factcheck) });
    styleResults.push({ slug: e.slug, ...result });
  }

  const regressions = [];
  const newFailures = [];

  for (const r of styleResults) {
    const base = baseline.entries[r.slug];
    if (STRICT) {
      if (r.errors > 0) newFailures.push(r);
    } else if (base === undefined) {
      // A new entry has no debt to inherit. It meets the standard or it waits.
      if (r.errors > 0) newFailures.push(r);
    } else if (r.errors > base.errors) {
      regressions.push({ ...r, was: base.errors });
    }
  }

  const show = (r, prefix) => {
    console.log(`  ${prefix} ${c.bold(r.slug)}  ${r.grade} (${r.score}/100)  ${r.errors} error(s), ${r.warnings} warning(s)`);
    for (const v of r.violations.filter((x) => x.level === 'error')) {
      console.log(`      ${c.red(v.code)}: ${v.msg}`);
    }
    if (VERBOSE) {
      for (const v of r.violations.filter((x) => x.level !== 'error')) {
        const tag = v.level === 'warn' ? c.yellow(v.code) : c.dim(v.code);
        console.log(`      ${tag}: ${v.msg}`);
      }
      const m = r.metrics;
      console.log(c.dim(`      flesch ${m.flesch} · ${m.wordCount}w · sd ${m.stdDev} · short ${Math.round(m.shortSentenceRatio * 100)}% · abstract ${m.abstractNounsPer100}/100 · numerals ${m.numeralsPer1000}/1k`));
    }
  };

  for (const r of regressions) {
    console.log(`  ${c.red('x')} ${c.bold(r.slug)} regressed: ${r.was} errors -> ${r.errors}`);
    show(r, ' ');
  }
  for (const r of newFailures) show(r, c.red('x'));

  failures += regressions.length + newFailures.length;

  // Corpus-wide: reused headings and shared passages only show up in aggregate.
  const corpus = corpusChecks(entries.map((e) => ({ slug: e.slug, body: e.body })));
  if (corpus.duplicateHeadings.length) {
    console.log(c.yellow(`\n  ${corpus.duplicateHeadings.length} section heading(s) reused across entries:`));
    for (const d of corpus.duplicateHeadings.slice(0, 8)) {
      console.log(`      "${d.text}" — ${d.slugs.length} entries: ${d.slugs.slice(0, 4).join(', ')}${d.slugs.length > 4 ? '…' : ''}`);
    }
  }
  if (corpus.duplicatePassages.length) {
    console.log(c.yellow(`\n  ${corpus.duplicatePassages.length} shared 12-word passage(s) — the template's fingerprint:`));
    for (const d of corpus.duplicatePassages.slice(0, 5)) {
      console.log(`      "${d.text.slice(0, 70)}…" — ${d.slugs.join(', ')}`);
    }
  }

  // Distribution, so the worklist has a shape.
  const grades = styleResults.reduce((acc, r) => ({ ...acc, [r.grade]: (acc[r.grade] ?? 0) + 1 }), {});
  const meanScore = Math.round(styleResults.reduce((s, r) => s + r.score, 0) / styleResults.length);
  const passing = styleResults.filter((r) => r.errors === 0).length;
  console.log(
    `\n  ${styleResults.length} entries · mean score ${meanScore}/100 · ` +
      `${passing} meet the full standard · ` +
      ['A', 'B', 'C', 'D', 'F'].map((g) => `${g}:${grades[g] ?? 0}`).join(' ')
  );

  const worst = [...styleResults].sort((a, b) => a.score - b.score).slice(0, 5);
  console.log(c.dim(`  worst five: ${worst.map((r) => `${r.slug} (${r.score})`).join(', ')}`));
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

if (UPDATE_BASELINE) {
  if (FILTER || ONLY) {
    console.error(c.red('\nRefusing to update the baseline from a filtered run — it would erase entries not examined.'));
    process.exit(1);
  }
  const next = {
    generated: new Date().toISOString().slice(0, 10),
    note: 'Error counts frozen by scripts/check.mjs. An entry may improve, never regress. Regenerate after a rewrite.',
    entries: Object.fromEntries(
      styleResults.map((r) => [r.slug, { errors: r.errors, warnings: r.warnings, score: r.score }])
    ),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(c.green(`\nBaseline written: ${path.relative(ROOT, BASELINE_PATH)} (${styleResults.length} entries)`));
  process.exit(0);
}

// ---------------------------------------------------------------------------

if (failures) {
  console.log(c.red(`\n${failures} check(s) failed.\n`));
  process.exit(1);
}
console.log(c.green('\nAll checks passed.\n'));
