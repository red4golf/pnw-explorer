import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Content lives in /content, not /src/content.
 *
 * The markdown IS the database. Keeping it outside src says so out loud: it is
 * data with its own lifecycle, edited through the CMS by someone who will never
 * open src/, and it should be movable to its own repo the day a second author
 * appears without touching a line of application code.
 */

/**
 * Geographic sanity bounds for the corpus.
 *
 * Deliberately generous — the guide reaches Manzanar in the Owens Valley
 * (36.7 N), Barkerville in the Cariboo (53.1 N), Bannack in Montana (-112.9 W),
 * and Cape Flattery (-124.7 W). This is not a "Pacific Northwest" box; it is a
 * "somebody typed the sign wrong or swapped lat and lng" box. Every real
 * coordinate error found in this corpus was one of those two mistakes, and both
 * land far outside these bounds.
 */
export const BOUNDS = { lat: [36, 56], lng: [-126, -110] } as const;

const coordinates = z
  .object({ lat: z.number(), lng: z.number() })
  .refine((c) => c.lat >= BOUNDS.lat[0] && c.lat <= BOUNDS.lat[1], {
    message: `lat is outside ${BOUNDS.lat[0]}..${BOUNDS.lat[1]} — a swapped lat/lng or a dropped minus sign`,
  })
  .refine((c) => c.lng >= BOUNDS.lng[0] && c.lng <= BOUNDS.lng[1], {
    message: `lng is outside ${BOUNDS.lng[0]}..${BOUNDS.lng[1]} — western longitudes must be negative`,
  });

/**
 * Hero image with attribution.
 *
 * `alt` is required, not optional. The previous build generated alt text as
 * "View of <title>", which is what a screen reader hears on every one of these
 * pages: nothing. If an image is worth shipping it is worth describing.
 *
 * `credit` / `source` / `license` exist because the fastest way to fill the
 * image gap in this corpus is Library of Congress, NARA, and state archives —
 * and public-domain and CC images carry attribution obligations that a schema
 * with nowhere to put them quietly turns into a licence violation.
 */
const hero = z.object({
  src: z.string().startsWith('/', 'Media paths are root-relative, e.g. /images/foo-hero.jpg'),
  alt: z.string().min(12, 'Write real alt text describing what is visible.'),
  credit: z.string().nullable().default(null),
  source: z.string().url().nullable().default(null),
  license: z
    .enum(['own-work', 'public-domain', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'permission', 'unknown'])
    .default('unknown'),
});

const book = z.object({
  title: z.string(),
  author: z.string().nullable().default(null),
  url: z.string().url().nullable().default(null),
  isbn: z.string().nullable().default(null),
});

/** Source tiers, quoted from the accuracy table in STYLE-STANDARD. */
const SOURCE_TIERS = ['primary', 'peer-reviewed', 'secondary', 'tribal', 'none'] as const;

const factcheck = z
  .object({
    status: z
      .enum(['unverified', 'in-review', 'verified', 'corrected', 'flagged'])
      .default('unverified'),
    lastChecked: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO date, e.g. 2026-07-09')
      .nullable()
      .default(null),
    reviewer: z.string().nullable().default(null),
    sourceTier: z.enum(SOURCE_TIERS).default('none'),
    claimsTotal: z.number().int().min(0).default(0),
    claimsCited: z.number().int().min(0).default(0),
    openFlags: z.number().int().min(0).default(0),
    neutrality: z.enum(['pass', 'fail', 'n/a']).default('n/a'),
    /**
     * Content hash captured at check time. A later edit changes the live hash
     * and flips the entry to "stale / re-review" automatically. This is the one
     * mechanism that stops a verified badge from outliving the text it verified.
     */
    checkedHash: z.string().nullable().default(null),
    notes: z.string().nullable().default(null),
  })
  .refine((f) => f.claimsCited <= f.claimsTotal, {
    message: 'claimsCited cannot exceed claimsTotal',
  })
  .refine((f) => f.status === 'unverified' || f.lastChecked !== null, {
    message: 'Any status other than "unverified" requires a lastChecked date',
  })
  .refine((f) => !['verified', 'corrected'].includes(f.status) || f.sourceTier !== 'none', {
    message: 'A verified or corrected entry must record the tier of its sources',
  })
  .default({});

const locations = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/locations' }),
  schema: z.object({
    title: z.string().min(3).max(70, 'Long titles get truncated in search results'),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slugs are lowercase, digits, single hyphens'),
    category: z.enum([
      'Aviation and Transportation',
      'Culture and Community',
      'Indigenous Heritage',
      'Industry and Agriculture',
      'Landmarks and Memorials',
      'Maritime',
      'Military and Conflict',
      'Natural Wonders',
      'Towns and Settlements',
    ]),
    period: z.string().nullable().default(null),
    address: z.string().nullable().default(null),
    coordinates,

    /**
     * The meta description, the card blurb, and the social preview text.
     * One field, one job, and a length the search results will actually show.
     *
     * The previous schema had a single `description` doing double duty as both
     * this and the on-page opening paragraph. 79 of 95 entries ran past 160
     * characters — some past 700 — so every page template truncated it to ~158
     * for the meta tag and cut mid-sentence. Splitting the field is the fix;
     * capping the old one would only have moved the truncation upstream.
     */
    summary: z.string().min(70).max(160),

    /**
     * The longer "why stop here" paragraph shown above the fold. Optional: when
     * absent the page falls back to the summary, which reads perfectly well.
     */
    lead: z.string().nullable().default(null),

    /**
     * "What to notice" — guide-voice prompts, second person, pointing at things
     * a visitor can actually see at THIS place.
     *
     * There is no generic per-category fallback. The previous build filled the
     * gap with two boilerplate lines keyed off the category, so 92 of 95 pages
     * showed prompts that applied to any fort, or any lighthouse, anywhere.
     * Generic prompts in a section headed "What to notice" are worse than an
     * absent section: they read as padding and they undercut the guide voice
     * every other part of the page is trying to establish. Absent means absent.
     */
    notice: z.array(z.string().min(20)).min(2).max(5).nullable().default(null),

    hero: hero.nullable().default(null),
    audio: z.string().startsWith('/').nullable().default(null),

    /** Editorial pipeline. Absent == published now. */
    draft: z.boolean().default(false),
    publishDate: z.string().nullable().default(null),

    books: z.array(book).default([]),
    factcheck,

    /** Provenance from the original Replit dataset. Kept for traceability only. */
    sourceId: z.number().int().nullable().default(null),
    mergedFrom: z
      .array(z.object({ id: z.number(), name: z.string() }))
      .nullable()
      .default(null),
  }),
});

export const collections = { locations };
