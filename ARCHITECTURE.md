# Architecture

Why this is built the way it is. The predecessor (`PNWHistoricalExplorer`) worked; most of what
follows is about the handful of places where its structure made the *next* change harder than it
needed to be.

---

## 1. Root path, not a subpath

The old site was served from `/PNWHistoricalExplorer/` on GitHub Pages. That prefix had to be kept
identical in three hand-maintained places — `astro.config.mjs`, `public/sw.js`, and
`manifest.webmanifest` — and its own README documented this as a hazard.

Three copies of a constant is not really the problem, though. The problem is that
`red4golf.github.io/PNWHistoricalExplorer` reads as a hobby project to a stranger arriving from a
search result, and this site carries monetised book links and a paid concierge line. Both convert
against perceived legitimacy.

So: one origin, one root, no prefix. `src/lib/url.ts` still exports `href()` as the identity
function and every template uses it, so a future move back under a prefix is one line rather than a
corpus-wide find and replace.

**Cost:** existing URLs die. Mitigated by `public/_redirects`, which maps the whole legacy subpath
and the five normalised slugs.

## 2. Content lives outside `src/`

`content/locations/`, not `src/content/locations/`. The markdown is data with its own lifecycle,
edited through a browser CMS by someone who will never open `src/`. Putting it beside the
application code implies it is part of the application, and it makes "split content into its own
repo when a second author appears" a migration instead of a `git mv`.

## 3. `description` split into `summary` and `lead`

The old schema had one `description` field doing two jobs: the meta description and the opening
paragraph. 79 of 95 entries ran past 160 characters — several past 700 — so every template
truncated it to ~158 for the meta tag and cut mid-sentence.

Capping the old field would only have moved the truncation upstream into the CMS. The fix is two
fields with one job each. The importer split them automatically and flagged the 38 entries where no
clean sentence boundary fit, so they can be hand-written rather than silently mangled.

## 4. Image attribution is in the schema

The old schema had `heroImage: string`. There was nowhere to record who took a photo or under what
licence.

That matters because the obvious way to close a 68-image gap is Library of Congress, NARA, and state
archives — and public-domain and Creative Commons images carry attribution obligations. A schema
with nowhere to put a credit line quietly converts a sourcing win into a licence violation. `hero`
is now an object with `alt`, `credit`, `source`, and `license`, and the build **fails** if a CC-BY
image has no credit.

`alt` is required, minimum 12 characters. The old template generated `alt="View of {title}"` — which
is what a screen reader announces on every one of these pages: nothing.

## 5. The style standard is executable

`docs/STYLE-STANDARD.md` ends with a section headed "Machine-checkable gate" listing ten numeric
rules. Nothing checked them. `src/lib/style.mjs` does.

It is plain `.mjs` rather than TypeScript so that **one implementation** serves three consumers —
the Node CI gate, the Astro build, and the `/admin` dashboard. If the dashboard and the gate
disagreed about whether an entry passes, nobody would trust either.

Validated against the standard's own published measurements: on `port-madison` it reports sentence
σ 9.9 (doc: 9.7), 37% short sentences (doc: 34%), 0.7 abstract nouns per 100 words (doc: 0.9); on
`yakama-nation-museum`, σ 5.9 and 10 uses of `while`, both exact. Flesch runs a few points higher
than the doc's figures because syllable heuristics differ between implementations — the scale
discriminates correctly (77 for the exemplar, 0.4 for the worst entry), but the floor of 50 is
calibrated to *this* implementation and should not be compared against numbers from another tool.

### The ratchet

Only 2 of 95 entries meet the full standard. A gate that fails 93 entries gets disabled, and then
the standard is a document again.

So `content/.style-baseline.json` freezes each entry's current error count, and the build fails only
on a regression or on a new entry carrying errors. This is the standard technique for introducing a
linter to a legacy codebase, and it is the difference between a rule and an aspiration.

## 6. Media indirection, and audio out of git

The old repo was 114 MB, essentially all of it media history — every clone and CI checkout dragged
it. Content now stores origin-agnostic paths and `src/lib/url.ts` resolves them against
`PUBLIC_MEDIA_BASE`.

The split is deliberate rather than uniform: **hero images stay in git** because they are needed for
every page render and every social card and a missing one is immediately visible; **audio does not**,
because 58 MB of narration that changes almost never is pure weight in every checkout. Flipping
either is one environment variable.

## 7. The service worker is generated

`scripts/build-sw.mjs` runs after the build, so:

- the cache version is a hash of the actual output — a deploy cannot forget to bump it;
- the precache list is read from what was really built, so it cannot name a route that 404s.
  An install-time 404 rejects the whole `addAll()`, which is how a site ships "offline support"
  that has never once worked. The generated worker also `put`s each shell URL individually so one
  bad entry cannot take down the rest;
- the origin layout exists in one place instead of three.

Audio and map-tile caches are deliberately **versionless**. A visitor who explicitly saved a
narration should not lose it because a stylesheet changed.

### The kill switch

The most damaging failure mode in this migration is invisible from the new site: a service worker
still registered at the old origin keeps serving its cached copy forever, to an origin nobody
deploys to. `build-sw.mjs` emits `sw-killswitch.js` for exactly this. Deploy it as `sw.js` at the
legacy address and leave it there.

## 8. Admin is not built unless asked for

`src/pages/admin/[...path].astro` is a rest route whose `getStaticPaths` returns `[]` unless
`INCLUDE_ADMIN=1`. Not hidden — **absent**. The old build shipped four admin pages on every deploy
and its README conceded they were "publicly reachable by URL".

Note it reads `process.env`, not `import.meta.env`: `getStaticPaths` runs in Node at build time, and
`import.meta.env` is populated from `.env` files rather than the shell, so a CI variable would never
be seen. That was a real bug during construction, caught because the admin page silently failed to
appear.

The four old dashboards are one page. For a single operator, one ranked worklist beats four views
that each show a slice and leave the prioritising to a human.

## 9. No hardcoded fallback secrets

The old `config.ts` shipped a GoatCounter dashboard token as a literal default, so the token was
public whether or not the operator knew it existed. Here an unset variable disables the feature that
needed it. Nothing in `config.ts` is treated as secret, because everything in it ends up in HTML.

## 10. What was kept

Astro, Pagefind, Leaflet, markdown-as-database, GoatCounter, Pages CMS, the accessibility-tuned
palette, and — most importantly — the `factcheck` staleness hash. That mechanism, where editing a
verified entry automatically drops its badge, is the best idea in the original codebase and most
content systems cannot do it at all.

## 11. What was added

- **Route corridor planner.** "What is worth stopping for between Seattle and Portland" is the
  actual question a road-trip guide exists to answer. `src/lib/geo.ts` computes perpendicular
  distance to a path; the map geocodes two endpoints and lists everything within a chosen detour,
  ordered by progress along the drive. It is a straight line, not a driving route, and the UI says
  so — honest about its limits and genuinely useful for a corridor like I-5.
- **Build-time "nearby"** on every location page: the three closest other places with distance and
  bearing. Free on a static site; the old build only offered "view on the map".
- **Dark mode.** This is read in a parked car at dusk. A cream page at full brightness is
  unpleasant, so the dark palette is a first-class surface.
- **Explicit "save for offline"** on narration. The moment a visitor wants the audio is exactly the
  moment they have no signal; saving has to be possible while they still have bars.
- **Smoke tests** over `dist/` for the failures a green build hides.

---

## Deliberately not done

- **A database, or any server.** Nothing here needs one. 95 entries of markdown with a build step
  is the right size, and it is why the site costs nothing to run and cannot fall over.
- **A spatial index for the map.** All 95 coordinates ship as one 42 KB JSON file. Past a few
  hundred entries this becomes tiles and a quadtree; building that now would solve a problem the
  site does not have.
- **Rewriting the concierge.** It is an ElevenLabs voice agent reached by phone and lives entirely
  outside this codebase. The site only decides which pages may mention it — a geofence, because
  advertising a Bainbridge service on a Crater Lake page trains readers to ignore it.
- **Fixing the prose.** The gate measures and freezes it. Rewriting 93 entries is editorial work,
  not an architectural decision, and doing it silently during a migration would have destroyed the
  provenance of every entry at once.
