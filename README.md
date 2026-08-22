# PNW Historical Explorer

A field guide to 95 historic places across the Pacific Northwest — full narratives, 36 audio
narrations, curated reading, an interactive map, a route-corridor planner, and offline support.

Static [Astro 5](https://astro.build) site, served from the root of its own domain, deployed on
Cloudflare Pages. The markdown in `content/` is the database.

```bash
npm install
npm run dev      # http://localhost:4321
npm run check    # content gate: frontmatter, coordinates, prose style
npm run build    # → dist/
npm run smoke    # post-build assertions against dist/
```

---

## Layout

```
content/locations/     95 markdown entries — the database
  .style-baseline.json frozen style-error counts (the ratchet; see below)
src/
  content.config.ts    schema; the enforcement point for everything structural
  lib/style.mjs        STYLE-STANDARD, executable — shared by CI, build, and /admin
  lib/quality.ts       verification status, grading, and the staleness rule
  lib/audit.ts         build-time integrity audit (media, links, attribution)
  lib/geo.ts           distance, bearing, and route-corridor maths
  pages/               home, map, categories, locations/[slug], search, about, offline, 404
  pages/admin/         operator dashboard — built ONLY when INCLUDE_ADMIN=1
scripts/
  import-legacy.mjs    one-way migration from the old repo (read-only at source)
  check.mjs            the content gate
  build-sw.mjs         generates the service worker + the legacy kill switch
  check-links.mjs      outbound link sweep (weekly, not on the merge path)
  media-push.mjs       upload public/media to R2
  optimize-images.mjs  regenerate webp variants
  smoke.mjs            post-build assertions
public/media/          hero images and audio narration (both tracked; see Media below)
docs/STYLE-STANDARD.md the writing standard scripts/check.mjs enforces
```

---

## The content gate

`npm run check` runs three things: frontmatter shape, coordinate sanity, and prose style measured
against [docs/STYLE-STANDARD.md](docs/STYLE-STANDARD.md).

The style check is a **ratchet, not a wall**. Most of the inherited corpus does not meet the
standard — 2 of 95 entries currently pass it cleanly. A gate that fails 93 entries on day one is a
gate that gets switched off in week two, so instead `content/.style-baseline.json` freezes each
entry's current error count, and the build fails only when:

- an entry gets **worse** than its baseline, or
- a **new** entry arrives carrying any errors at all.

Inherited debt is frozen and visible. New debt is impossible. Every rewrite lowers a number.

```bash
npm run check                                    # ratchet (what CI runs)
node scripts/check.mjs --strict                  # full standard, all entries
node scripts/check.mjs --strict --filter=port-madison --verbose
node scripts/check.mjs --update-baseline         # lock in improvements
```

Run `--update-baseline` after a rewrite and commit the result; the improvement can then never
regress.

### What it measures

Flesch reading ease, sentence-length standard deviation ("the rhythm test"), the share of sentences
at 12 words or fewer, abstract-noun density, numerals per thousand words, the `while` weld, banned
evaluative adjectives, `stands as` / `serves as` / `represents` as main verbs, participial brochure
openers, metronomic paragraphing, generic section headings, and — across the whole corpus —
12-word passages shared between entries.

That last one is the most revealing: 302 shared passages currently, including three Indigenous
heritage entries that share entire sentences.

---

## Adding a location

1. Add a markdown file to `content/locations/`, or use the CMS.
2. Drop a hero JPG in `public/media/images/locations/` named `<slug>-hero.jpg`, then
   `npm run images`.
3. Optional narration MP3 in `public/media/audio/`, referenced as `/audio/<slug>.mp3`.
4. `npm run check` — a new entry must meet the full standard.

The schema (`src/content.config.ts`) enforces the things that are cheap to get wrong:

- `summary` is 70–160 characters, because it is the meta description **and** the card blurb. The
  long opening paragraph is a separate field, `lead`.
- `coordinates` must fall inside the region. Every real coordinate error in this corpus was a
  swapped lat/lng or a dropped minus sign, and both land far outside the bounds.
- `hero.alt` is **required** and must be at least 12 characters.
- CC-BY-licensed images must carry a credit line — the build fails without one.
- `factcheck.claimsCited` cannot exceed `claimsTotal`; a `verified` status requires a source tier
  and a check date.

---

## Verification

Each entry carries a `factcheck` record, and the public "researched and sourced" badge is a
transparent function of it — never a judgement call.

The mechanism worth knowing about: a verified entry stores `checkedHash`, a fingerprint of the text
it was checked against. Editing the text changes the live hash, the entry flips to **stale**, and
the badge disappears from the public page automatically until someone re-reviews it. A verification
claim that outlives the words it verified is worse than no claim at all.

---

## Media and R2

Content stores media paths origin-agnostically (`/images/locations/x-hero.jpg`). `src/lib/url.ts`
resolves them:

| `PUBLIC_MEDIA_BASE` | Resolves to |
| --- | --- |
| unset | `/media/images/locations/x-hero.jpg` (same origin) |
| `https://media.example.com` | `https://media.example.com/images/locations/x-hero.jpg` |

**Today both hero images and audio are tracked in git** (~114 MB), and the site serves them from its
own origin. That is not the intended end state — 58 MB of narration that changes almost never has no
business in every clone and every CI checkout — but R2 is not enabled on the Cloudflare account
(API error 10042; enabling it requires a payment method, and the wrangler token carries no `r2`
scope). Shipping a repo whose every build fails and whose narration 404s in production is the worse
trade.

The indirection is already in place, so moving media out later costs no content edits:

```bash
# 1. Enable R2 in the Cloudflare dashboard, then:
npx wrangler login                                   # re-auth to pick up the r2 scope
npx wrangler r2 bucket create pnw-explorer-media
npm run media:push --dry-run                         # then for real
# 2. Attach a custom domain to the bucket
# 3. Set PUBLIC_MEDIA_BASE in the Pages project and as a repo variable
# 4. Re-add `public/media/audio/` to .gitignore and `git rm -r --cached` it
```

---

## Deploying

Cloudflare Pages, build command `npm run build`, output `dist`.

| Variable | Purpose |
| --- | --- |
| `SITE_URL` | canonical origin |
| `PUBLIC_MEDIA_BASE` | R2 media origin |
| `PUBLIC_AMAZON_TAG` | Associates tag appended to book links at build |
| `PUBLIC_GOATCOUNTER_CODE` | analytics subdomain |
| `PUBLIC_GOOGLE_SITE_VERIFICATION` | Search Console |
| `INCLUDE_ADMIN` | `1` to build `/admin` — only with Access in front of it |

`public/_headers` and `public/_redirects` are read by Pages directly. The redirects preserve the
legacy `/PNWHistoricalExplorer/*` subpath and the five slugs normalised during migration.

### The service worker, and the one thing that can go badly wrong

`scripts/build-sw.mjs` generates `dist/sw.js` after the build, so the cache version is derived from
the actual output and the precache list can never name a route that was not built.

It also emits **`dist/sw-killswitch.js`**. Anyone who ever visited the old GitHub Pages address has
a service worker registered there that will keep serving its cached copy of the site indefinitely,
on an origin nobody deploys to any more. Those visitors are frozen on a dead version and are
invisible in the new site's analytics.

**Deploy `sw-killswitch.js` as `sw.js` at the legacy origin, and leave it there for several weeks.**
It unregisters the stale worker, clears its caches, and reloads open tabs, which then follow the
redirect.

---

## Operator dashboard

`/admin` — worklist, prose-style report, verification status, integrity audit, and coverage by
category. Every number is computed at build time; there is no API and no secret in the page.

It is **not built at all** unless `INCLUDE_ADMIN=1`. Put Cloudflare Access in front of the route
before enabling it: the previous build shipped its admin pages on every deploy and relied on nobody
guessing the URL.

---

## Editing content

[Pages CMS](https://app.pagescms.org) — sign in with GitHub, pick this repo. Config in `.pages.yml`.
Saving commits to GitHub, which triggers a build. Keep `.pages.yml` in step with
`src/content.config.ts`; where they disagree the schema wins, and the CMS will happily save a field
the build then rejects.

---

## Privacy and disclosure

No login, no accounts, no advertising network. "Find places near me" keeps coordinates on the
device. GoatCounter sets no cookies, which is why there is no cookie banner. Amazon links carry
`rel="nofollow sponsored"` per the FTC endorsement guides, and `/about` discloses the relationship
whenever a tag is configured.

See [ARCHITECTURE.md](ARCHITECTURE.md) for why the structural decisions were made.
