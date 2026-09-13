/**
 * Driving routes and time matrices from OSRM, plus the ferry stitching the
 * router cannot do for itself. Browser-only: everything here fetches.
 *
 * The public instance is the one FOSSGIS runs for openstreetmap.org. There is
 * no SLA and no key; every answer is cached for the session so re-running a
 * search does not re-hit a service somebody else pays for.
 */
import { distanceMiles, type Point } from './geo';
import { MISSING_CROSSINGS, sailings, type Crossing, type Sailing } from './ferries';

export const OSRM = 'https://routing.openstreetmap.de/routed-car';

const TIMEOUT_MS = 12000;

/** Public OSRM instances cap the coordinates a table request may carry. */
export const TABLE_LIMIT = 45;

export interface Leg {
  kind: 'drive' | 'sail';
  start: Point;
  end: Point;
  path: Point[];
  miles: number;
  minutes: number;
  /** Drive legs: the router itself sailed somewhere inside this leg. */
  usesFerry: boolean;
  /** Sail legs: which crossing. */
  crossing: Crossing | null;
}

export interface RouteOption {
  id: string;
  /** "Drive around" or "Via the Seattle–Bainbridge ferry". */
  label: string;
  legs: Leg[];
  /** All legs joined, for drawing and for the geometric shortlist. */
  path: Point[];
  miles: number;
  minutes: number;
  /** Sails somewhere — by the router or by the crossings table. */
  usesFerry: boolean;
  /** The table crossing this option stitches in, if any. */
  crossing: Crossing | null;
}

const fmt = (p: Point) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;

async function cached<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
  const k = `pnw-osrm:${key}`;
  try {
    const hit = sessionStorage.getItem(k);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    /* private browsing — just fetch */
  }
  const value = await load();
  if (value !== null) {
    try {
      sessionStorage.setItem(k, JSON.stringify(value));
    } catch {
      /* quota or private mode — the cache is an optimisation, not a requirement */
    }
  }
  return value;
}

/**
 * One driving leg between two points.
 *
 * steps=true so ferry legs can be detected: OSRM marks them mode:"ferry", and
 * in Puget Sound whether the route sails matters more to a traveller than
 * almost anything else about it.
 *
 * No `exclude=ferry`: this instance rejects the exclude parameter outright
 * ("Exclude flag combination is not supported"), for ferries and motorways
 * alike. An avoid-ferries toggle would have failed every time, and silently.
 */
export function fetchDrivingLeg(from: Point, to: Point): Promise<Leg | null> {
  return cached(`route:${fmt(from)}>${fmt(to)}`, async () => {
    const params = new URLSearchParams({
      overview: 'simplified',
      geometries: 'geojson',
      steps: 'true',
    });
    const url = `${OSRM}/route/v1/driving/${fmt(from)};${fmt(to)}?${params}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.code !== 'Ok' || !json.routes?.length) return null;

    const r = json.routes[0];
    const usesFerry = (r.legs ?? []).some((leg: any) =>
      (leg.steps ?? []).some((step: any) => step.mode === 'ferry')
    );
    return {
      kind: 'drive',
      start: from,
      end: to,
      path: (r.geometry.coordinates as Array<[number, number]>).map(([lng, lat]) => ({ lat, lng })),
      miles: r.distance / 1609.344,
      minutes: r.duration / 60,
      usesFerry,
      crossing: null,
    };
  });
}

/**
 * Driving seconds between chosen sources and destinations, as OSRM's table
 * service returns them: `durations[si][dj]`, null where unreachable.
 */
export function fetchDurations(
  coords: Point[],
  sources: number[],
  destinations: number[]
): Promise<Array<Array<number | null>> | null> {
  if (!coords.length || coords.length > TABLE_LIMIT) return Promise.resolve(null);
  const key = `table:${coords.map(fmt).join(';')}|${sources.join(',')}|${destinations.join(',')}`;
  return cached(key, async () => {
    const url =
      `${OSRM}/table/v1/driving/${coords.map(fmt).join(';')}` +
      `?sources=${sources.join(';')}&destinations=${destinations.join(';')}&annotations=duration`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.code !== 'Ok' || !Array.isArray(json.durations)) return null;
    return json.durations as Array<Array<number | null>>;
  });
}

/**
 * Is this sailing even roughly on the way? Crow-flies test only, to avoid a
 * table request for Seattle→Portland that asks about Kingston. Generous on
 * purpose: driving times decide, this just prunes the absurd.
 */
const plausible = (from: Point, to: Point, s: Sailing): boolean =>
  distanceMiles(from, s.x) + distanceMiles(s.y, to) <= distanceMiles(from, to) * 1.3 + 20;

/**
 * A stitched ferry route is offered alongside the road route when it is in
 * the same league — up to a quarter longer plus a quarter hour. Bainbridge to
 * Tacoma is the case that matters: about an hour over the Narrows, or 80
 * minutes sailing to Seattle and driving down I-5, and the two pass entirely
 * different places. Which is "better" depends on what you want to see, so the
 * traveller gets both. Seattle to Portland via Bremerton, 245 minutes against
 * 170, is not a real choice and is not offered.
 */
const competitive = (ferryMinutes: number, roadMinutes: number): boolean =>
  ferryMinutes <= roadMinutes * 1.25 + 15;

function join(legs: Leg[], id: string, label: string, crossing: Crossing | null): RouteOption {
  return {
    id,
    label,
    legs,
    path: legs.flatMap((l) => l.path),
    miles: legs.reduce((m, l) => m + l.miles, 0),
    minutes: legs.reduce((m, l) => m + l.minutes, 0),
    usesFerry: legs.some((l) => l.kind === 'sail' || l.usesFerry),
    crossing,
  };
}

/**
 * Route options from A to B, fastest first: the router's own answer, plus at
 * most one route stitched through a crossing the router does not know
 * (drive → sail → drive), when that is competitive.
 *
 * Cost: one route request, plus — only when a missing crossing is plausibly
 * on the way — one table request against all its terminals and two route
 * requests for the winning stitch.
 */
export async function planRoutes(
  from: Point,
  to: Point,
  crossings: readonly Crossing[] = MISSING_CROSSINGS
): Promise<RouteOption[]> {
  const road = await fetchDrivingLeg(from, to);
  if (!road) return [];
  const roadOption = join([road], 'road', road.usesFerry ? 'Router’s route' : 'Drive around', null);

  const candidates = sailings(crossings).filter((s) => plausible(from, to, s));
  if (!candidates.length) return [roadOption];

  // One matrix: from → every terminal, and every terminal → to.
  const terminals = Array.from(
    new Map(candidates.flatMap((s) => [s.x, s.y]).map((t) => [fmt(t), t])).values()
  );
  const coords = [from, to, ...terminals];
  const tIdx = terminals.map((_, i) => i + 2);
  const durations = await fetchDurations(coords, [0, ...tIdx], [...tIdx, 1]).catch(() => null);
  if (!durations) return [roadOption];

  const toTerminal = (t: Point) => durations[0]?.[terminals.findIndex((u) => fmt(u) === fmt(t))];
  const fromTerminal = (t: Point) =>
    durations[terminals.findIndex((u) => fmt(u) === fmt(t)) + 1]?.[terminals.length];

  let best: { s: Sailing; minutes: number } | null = null;
  for (const s of candidates) {
    const out = toTerminal(s.x);
    const back = fromTerminal(s.y);
    if (typeof out !== 'number' || typeof back !== 'number') continue;
    // A leg to or from the terminal that takes longer than the whole road
    // trip means the router drove around the water to reach the dock — the
    // wrong side, or the wrong crossing.
    if (out / 60 >= road.minutes || back / 60 >= road.minutes) continue;
    const minutes = (out + back) / 60 + s.crossing.sailMinutes;
    if (!best || minutes < best.minutes) best = { s, minutes };
  }
  if (!best || !competitive(best.minutes, road.minutes)) return [roadOption];

  const { s } = best;
  const [a, b] = await Promise.all([fetchDrivingLeg(from, s.x), fetchDrivingLeg(s.y, to)]);
  if (!a || !b) return [roadOption];

  const sail: Leg = {
    kind: 'sail',
    start: s.x,
    end: s.y,
    path: [s.x, s.y],
    miles: distanceMiles(s.x, s.y),
    minutes: s.crossing.sailMinutes,
    usesFerry: true,
    crossing: s.crossing,
  };
  const ferryOption = join(
    [a, sail, b],
    `ferry:${s.crossing.id}`,
    `Via the ${s.crossing.name} ferry`,
    s.crossing
  );

  return [roadOption, ferryOption].sort((p, q) => p.minutes - q.minutes);
}

export interface DetourTime {
  /** Extra minutes the whole trip costs if you go via this place. */
  detour: number;
  /** Driving minutes from the start to this place — i.e. when you reach it. */
  fromStart: number;
}

/**
 * How much longer the whole trip takes if you go via each place, in minutes.
 *
 *     detour = time(legStart -> place -> legEnd) - time(leg)
 *
 * measured against each driving leg, keeping the cheapest. On a plain road
 * route there is one leg and this is exactly time(start→place→end) minus the
 * trip. On a stitched ferry route a stop is inserted into whichever driving
 * leg it is cheapest to leave — the far-shore leg for a far-shore place —
 * instead of the router being asked to drive around the Sound to reach it.
 *
 * `fromStart` is the ordering key: the minutes at which you actually REACH
 * the place, counting every leg before the one it is inserted into.
 *
 * One table request per driving leg. The matrix is asked for with the leg
 * start and every candidate as sources, and every candidate plus the leg end
 * as destinations, so row 0 gives start→place and the last column place→end.
 */
export async function fetchDetourTimes(
  option: RouteOption,
  targets: Point[]
): Promise<DetourTime[] | null> {
  const n = targets.length;
  if (!n || n + 2 > TABLE_LIMIT) return null;

  const best: DetourTime[] = targets.map(() => ({ detour: Infinity, fromStart: Infinity }));
  let offset = 0;
  let measured = false;

  for (const leg of option.legs) {
    if (leg.kind !== 'drive') {
      offset += leg.minutes;
      continue;
    }
    const coords = [leg.start, ...targets, leg.end];
    const sources = [0, ...targets.map((_, i) => i + 1)];
    const destinations = [...targets.map((_, i) => i + 1), n + 1];
    const durations = await fetchDurations(coords, sources, destinations).catch(() => null);
    if (durations) {
      measured = true;
      targets.forEach((_, i) => {
        const out = durations[0]?.[i];
        const back = durations[i + 1]?.[n];
        if (typeof out !== 'number' || typeof back !== 'number') return;
        // Never negative: a place genuinely on the route can measure a few
        // seconds "faster" than the leg through routing noise.
        const detour = Math.max(0, (out + back) / 60 - leg.minutes);
        if (detour < best[i].detour) best[i] = { detour, fromStart: offset + out / 60 };
      });
    }
    offset += leg.minutes;
  }

  if (!measured) return null;
  return best.map((t) => (Number.isFinite(t.detour) ? t : { detour: NaN, fromStart: NaN }));
}
