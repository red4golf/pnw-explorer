/**
 * Build-time integrity audit.
 *
 * Runs during `astro build` in Node, so it can read the raw markdown and check
 * that referenced media actually exists on disk. Everything here is
 * deterministic and offline — no network calls, so a slow or blocked host can
 * never turn a content check into a flaky build.
 *
 * Feeds /admin/pipeline. Kept separate from style.mjs because the two answer
 * different questions: style asks "is this written well", audit asks "is this
 * wired up correctly".
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Loc } from './publish';

export type IssueLevel = 'error' | 'warn' | 'info';

export interface Issue {
  level: IssueLevel;
  code: string;
  msg: string;
}

export interface EntryAudit {
  slug: string;
  title: string;
  category: string;
  issues: Issue[];
  worst: IssueLevel | 'ok';
  hasHero: boolean;
  hasAudio: boolean;
  hasNotice: boolean;
}

/** Raw title length, before the site-wide suffix is appended. */
const TITLE_MAX = 60;

const PUBLIC_DIR = path.join(process.cwd(), 'public');

/**
 * Does a content media path resolve to a real file?
 *
 * Only meaningful when media is served from this repo. Once PUBLIC_MEDIA_BASE
 * points at R2 the files are legitimately absent from the working tree, so the
 * check reports "not verifiable" rather than inventing 95 false errors.
 */
export const mediaIsLocal = !process.env.PUBLIC_MEDIA_BASE;

export function mediaExists(contentPath: string): boolean {
  if (!mediaIsLocal) return true;
  if (!contentPath || !contentPath.startsWith('/')) return false;
  return existsSync(path.join(PUBLIC_DIR, 'media', contentPath));
}

/** Pull every link and image target out of a markdown body. */
export function extractTargets(body: string): string[] {
  const out: string[] = [];
  const md = /\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
  const html = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = md.exec(body))) out.push(m[1]);
  while ((m = html.exec(body))) out.push(m[1]);
  return out;
}

const rank = (l: IssueLevel | 'ok'): number =>
  l === 'error' ? 3 : l === 'warn' ? 2 : l === 'info' ? 1 : 0;

const worstOf = (issues: Issue[]): IssueLevel | 'ok' =>
  issues.reduce<IssueLevel | 'ok'>((w, i) => (rank(i.level) > rank(w) ? i.level : w), 'ok');

/**
 * Alt text that merely restates the title is what the importer generated when
 * no human had written any. Catching it here keeps a migration placeholder from
 * quietly becoming the permanent answer.
 */
export const isPlaceholderAlt = (alt: string, title: string): boolean =>
  alt.startsWith(`${title} — `) && / site in the Pacific Northwest$/.test(alt);

export function auditEntry(entry: Loc, validSlugs: Set<string>): EntryAudit {
  const d = entry.data;
  const issues: Issue[] = [];

  // --- Title ---------------------------------------------------------------
  if (d.title.length > TITLE_MAX) {
    issues.push({
      level: 'warn',
      code: 'title-long',
      msg: `Title is ${d.title.length} chars — long titles get cut off in results.`,
    });
  }

  // --- Hero image and attribution -----------------------------------------
  if (!d.hero) {
    issues.push({
      level: 'warn',
      code: 'no-hero',
      msg: 'No hero image — the page opens on a flat colour and social shares fall back to the generic card.',
    });
  } else {
    if (!mediaExists(d.hero.src)) {
      issues.push({
        level: 'error',
        code: 'hero-missing-file',
        msg: `hero.src is ${d.hero.src}, but no such file exists under public/media.`,
      });
    }
    if (isPlaceholderAlt(d.hero.alt, d.title)) {
      issues.push({
        level: 'warn',
        code: 'placeholder-alt',
        msg: 'Alt text is the migration placeholder. Describe what is actually visible in the photo.',
      });
    }
    if (d.hero.license === 'unknown') {
      issues.push({
        level: 'warn',
        code: 'unknown-licence',
        msg: 'Image licence is unknown. Record the source and licence, or replace the image with one whose provenance is known.',
      });
    }
    if (['cc-by', 'cc-by-sa', 'cc-by-nc'].includes(d.hero.license) && !d.hero.credit) {
      issues.push({
        level: 'error',
        code: 'missing-attribution',
        msg: `Licence "${d.hero.license}" legally requires attribution, and no credit is recorded.`,
      });
    }
  }

  // --- Audio ---------------------------------------------------------------
  if (d.audio && !mediaExists(d.audio)) {
    issues.push({
      level: 'error',
      code: 'audio-missing-file',
      msg: `audio is ${d.audio}, but no such file exists under public/media.`,
    });
  }

  // --- Guide voice ---------------------------------------------------------
  if (!d.notice) {
    issues.push({
      level: 'info',
      code: 'no-notice',
      msg: 'No "what to notice" prompts, so that section does not render. Two or three specific observations make the page useful on site.',
    });
  }

  // --- Structured data -----------------------------------------------------
  if (!d.address) {
    issues.push({
      level: 'info',
      code: 'no-address',
      msg: 'No address — the TouristAttraction structured data omits a postal address.',
    });
  }

  // --- Further reading -----------------------------------------------------
  if (!d.books.length) {
    issues.push({ level: 'info', code: 'no-books', msg: 'No further reading listed.' });
  }
  for (const b of d.books) {
    if (!b.url) {
      issues.push({
        level: 'info',
        code: 'book-no-url',
        msg: `Further-reading item “${b.title}” has no link.`,
      });
    }
  }

  // --- Internal links and asset references in the body ---------------------
  for (const raw of extractTargets(entry.body ?? '')) {
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) continue;
    if (/^https?:\/\//i.test(raw)) continue;

    const p = raw.split(/[?#]/)[0];
    if (!p.startsWith('/')) continue;

    const locMatch = /^\/locations\/([^/]+)\/?$/.exec(p);
    if (locMatch) {
      if (!validSlugs.has(locMatch[1])) {
        issues.push({
          level: 'error',
          code: 'dead-internal-link',
          msg: `Body links to /locations/${locMatch[1]}, which is not a published entry.`,
        });
      }
      continue;
    }
    if (/^\/(images|audio)/.test(p) && !mediaExists(p)) {
      issues.push({
        level: 'error',
        code: 'dead-asset-link',
        msg: `Body references ${p}, which is missing from public/media.`,
      });
    }
  }

  return {
    slug: d.slug,
    title: d.title,
    category: d.category,
    issues,
    worst: worstOf(issues),
    hasHero: Boolean(d.hero),
    hasAudio: Boolean(d.audio),
    hasNotice: Boolean(d.notice),
  };
}

export interface SiteAudit {
  entries: EntryAudit[];
  totals: { errors: number; warnings: number; infos: number; clean: number };
  byCode: Array<{ code: string; level: IssueLevel; count: number; msg: string }>;
  coverage: { hero: number; audio: number; notice: number; total: number };
}

export function auditSite(locations: Loc[]): SiteAudit {
  const validSlugs = new Set(locations.map((l) => l.data.slug));
  const entries = locations
    .map((l) => auditEntry(l, validSlugs))
    .sort((a, b) => rank(b.worst) - rank(a.worst) || a.title.localeCompare(b.title));

  const totals = { errors: 0, warnings: 0, infos: 0, clean: 0 };
  const codeMap = new Map<string, { level: IssueLevel; count: number; msg: string }>();

  for (const e of entries) {
    // "Clean" means free of errors and warnings. Info-level notes are
    // nice-to-haves, not defects, and counting them as failures would make the
    // number useless for deciding what to work on.
    if (e.worst === 'ok' || e.worst === 'info') totals.clean++;
    for (const i of e.issues) {
      if (i.level === 'error') totals.errors++;
      else if (i.level === 'warn') totals.warnings++;
      else totals.infos++;

      const prev = codeMap.get(i.code);
      if (prev) prev.count++;
      else codeMap.set(i.code, { level: i.level, count: 1, msg: i.msg });
    }
  }

  const byCode = [...codeMap.entries()]
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => rank(b.level) - rank(a.level) || b.count - a.count);

  return {
    entries,
    totals,
    byCode,
    coverage: {
      hero: entries.filter((e) => e.hasHero).length,
      audio: entries.filter((e) => e.hasAudio).length,
      notice: entries.filter((e) => e.hasNotice).length,
      total: entries.length,
    },
  };
}
