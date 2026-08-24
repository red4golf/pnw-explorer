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

The intended split was hero images in git and audio in R2 — the images are needed for every page
render and a missing one is immediately visible, while 58 MB of narration that changes almost never
is pure weight in every checkout.

**That is not what shipped.** R2 turned out not to be enabled on the Cloudflare account (API error
10042), enabling it requires a payment method, and the wrangler token carries no `r2` scope. So both
are tracked for now, and the repo is ~114 MB rather than ~56 MB.

The decision worth recording is *why the indirection was built anyway*. Because content stores
origin-agnostic paths and resolution happens in one function, the eventual move is an environment
variable and a `.gitignore` line — not a rewrite of 95 markdown files. Designing the seam before it
was needed cost nothing and is what keeps the wrong-for-now choice cheap to reverse.

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
  actual question a road-trip guide exists to answer. The map geocodes two endpoints via Nominatim,
  fetches the real driving geometry from OSRM, and lists everything within a chosen detour of that
  polyline, ordered by progress along the drive.

  It shipped first as a straight line between the endpoints, which was wrong in a way worth
  recording: in Puget Sound a straight line is not an approximation of a drive, it is a different
  shape. Seattle to Port Townsend is about 40 miles across the water and 111 by road, because the
  route runs south around the Sound through Tacoma and back north up the Kitsap Peninsula. The
  straight corridor invented stops on the far shore and hid every one actually passed.

  Ordering needs the same care: `nearestOnPath` returns distance, the point where you would leave
  the road, and progress along the drive in one traversal, and stops are sorted by progress rather
  than by distance from the origin. On any drive that rounds water the two disagree, and sorting by
  the latter hands the reader their stops out of order.

  **The detour budget is time, not distance**, and getting there took three passes, each one
  caught by a real query rather than by reasoning.

  First the *filter* was still miles while the answer was minutes. Bainbridge Island to Tacoma
  returned Pike Place Market at 9.0 miles from the route and 248 minutes out of the way — it is
  across Puget Sound, so reaching it means driving the whole way around. Every Seattle entry in
  that result was the same mismatch.

  Then the definition itself was wrong. The measure was a round trip from the nearest point on the
  road — leave here, drive there, drive back to the same spot — which invents a return leg that
  does not exist when the place sits at your destination. Fort Nisqually, *inside* the destination
  city, was reported as 39 minutes out of the way. What a traveller actually wants is

      detour = time(start → place → end) − time(start → end)

  which puts it at 25. The overstatement was far worse across water: Pike Place measured 248 against
  a true 87. Same single `table` request either way — the matrix is asked for with the start and
  every candidate as sources, and every candidate plus the end as destinations, so row 0 gives
  start→place and the last column gives place→end.

  So distance is now only a pre-filter, used to build the shortlist the table service needs. A
  detour cannot beat the crow flies, so at a generous 60 mph each way `budget / 2` miles is a hard
  upper bound on how far out a place can be and still fit; it over-includes on purpose, and real
  driving times do the actual filtering.

  Ordering needed a tiebreak for the same reason. Every place whose closest approach is the route's
  first point scores a progress of exactly zero — twelve of twenty-one in that query — and a stable
  sort with nothing to discriminate on falls back to input order, which is alphabetical. It sorted
  Bruce Lee, Camp Yeomalt, Fort Ward, Japanese American Exclusion Memorial and looked deliberate.
  Ties now break on detour time.

  **What was measured about ferries**, rather than assumed. OSRM does route over them: Anacortes to
  Friday Harbor returns a `mode: "ferry"` step, because no bridge exists. But where a land route
  also exists it tends to prefer driving around — Seattle to Bainbridge comes back as 92 miles and
  two hours rather than the ferry. And `exclude=ferry` is rejected outright by this instance
  ("Exclude flag combination is not supported"), for motorways too. So there is no avoid-ferries
  toggle: one was built, found to fail on every request, and removed rather than shipped as a
  control that silently does nothing. What ships instead is detection — the route says when it
  sails, and says that the crossing and terminal wait are not in the number.

  If routing is unavailable the planner falls back to the straight line, draws it dashed rather
  than solid, and says in words that it is an estimate — degraded, and visibly so, rather than a
  guess wearing a route's clothes.
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
