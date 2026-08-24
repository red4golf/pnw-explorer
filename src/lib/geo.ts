/**
 * Geography helpers, shared by the map, the homepage "near me" panel, and the
 * route planner. Kept in one place so distance is computed identically
 * everywhere — a guide that says 4 miles on one screen and 6 on another has
 * quietly told the reader not to trust it.
 */

export interface Point {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_MILES = 3958.8;
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance in statute miles. */
export function distanceMiles(a: Point, b: Point): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

/** Compass bearing from a to b, in degrees clockwise from north. */
export function bearing(a: Point, b: Point): number {
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** "NE", "SSW"-free 8-point compass label — enough to orient, not enough to mislead. */
export const compassLabel = (deg: number): string => COMPASS[Math.round(deg / 45) % 8];

/**
 * Distance phrased the way a driver reads it. Under a tenth of a mile is "right
 * here"; under ten miles keeps a decimal because the difference between 2.1 and
 * 2.9 miles decides whether you stop.
 */
export function formatDistance(miles: number): string {
  if (miles < 0.1) return 'right here';
  if (miles < 1) return `${Math.round(miles * 10) / 10} mi`;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

/** The n closest items to a point, nearest first, each tagged with its distance. */
export function nearest<T extends Point>(
  from: Point,
  items: readonly T[],
  limit = 6,
  maxMiles = Infinity
): Array<T & { miles: number; bearing: number }> {
  return items
    .map((item) => ({
      ...item,
      miles: distanceMiles(from, item),
      bearing: bearing(from, item),
    }))
    .filter((x) => x.miles <= maxMiles)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, limit);
}

/**
 * Perpendicular distance in miles from a point to a great-circle segment,
 * clamped to the segment's endpoints.
 *
 * This is what makes "what is worth stopping for between Seattle and Portland"
 * answerable: sample the driving route, then keep every location within a
 * detour radius of the line. At these latitudes and segment lengths a flat
 * equirectangular projection is accurate to well under a tenth of a mile, which
 * is far below the precision anyone acts on.
 */
export function projectOnSegment(p: Point, a: Point, b: Point): { distance: number; t: number } {
  const scale = Math.cos(toRad((a.lat + b.lat) / 2));
  const px = p.lng * scale;
  const py = p.lat;
  const ax = a.lng * scale;
  const ay = a.lat;
  const bx = b.lng * scale;
  const by = b.lat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projLat = ay + t * dy;
  const projLng = (ax + t * dx) / scale;

  return { distance: distanceMiles(p, { lat: projLat, lng: projLng }), t };
}

export const distanceToSegment = (p: Point, a: Point, b: Point): number =>
  projectOnSegment(p, a, b).distance;

export interface NearestOnPath {
  /** The point on the path closest to the query point. */
  point: Point;
  /** Straight-line miles from the query point to that point. */
  distance: number;
  /** Miles travelled along the path to reach it, from the start. */
  progress: number;
}

/**
 * Closest approach of a point to a polyline: where on the line it is, how far
 * away, and how far along.
 *
 * `point` is what makes a real detour cost computable — it is the place you
 * would actually leave the road, so routing from there to the destination and
 * back is the detour. `progress` is what orders stops correctly: sorting by
 * straight-line distance from the origin looks right on a straight drive and
 * goes wrong on every real one, because on a route that rounds water a place
 * late in the drive can sit closer to the start than one passed an hour
 * earlier.
 */
export function nearestOnPath(p: Point, path: readonly Point[]): NearestOnPath {
  if (!path.length) return { point: p, distance: Infinity, progress: 0 };
  if (path.length === 1) return { point: path[0], distance: distanceMiles(p, path[0]), progress: 0 };

  let best: NearestOnPath = { point: path[0], distance: Infinity, progress: 0 };
  let travelled = 0;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segment = distanceMiles(a, b);
    const { distance, t } = projectOnSegment(p, a, b);
    if (distance < best.distance) {
      best = {
        point: { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) },
        distance,
        progress: travelled + t * segment,
      };
    }
    travelled += segment;
  }
  return best;
}

/** Miles along the path to the point's closest approach. */
export const progressAlongPath = (p: Point, path: readonly Point[]): number =>
  nearestOnPath(p, path).progress;

/** Total length of a polyline in miles. */
export const pathLength = (path: readonly Point[]): number =>
  path.length < 2 ? 0 : path.slice(1).reduce((sum, pt, i) => sum + distanceMiles(path[i], pt), 0);

/** Shortest distance from a point to any leg of a polyline. */
export const distanceToPath = (p: Point, path: readonly Point[]): number =>
  nearestOnPath(p, path).distance;

/** Bounding box of a set of points, padded by a margin in degrees. */
export function boundsOf(points: readonly Point[], pad = 0.25) {
  if (!points.length) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    south: Math.min(...lats) - pad,
    north: Math.max(...lats) + pad,
    west: Math.min(...lngs) - pad,
    east: Math.max(...lngs) + pad,
  };
}
