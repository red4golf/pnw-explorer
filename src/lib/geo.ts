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
export function distanceToSegment(p: Point, a: Point, b: Point): number {
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

  return distanceMiles(p, { lat: projLat, lng: projLng });
}

/** Shortest distance from a point to any leg of a polyline. */
export const distanceToPath = (p: Point, path: readonly Point[]): number =>
  path.length < 2
    ? path.length === 1
      ? distanceMiles(p, path[0])
      : Infinity
    : Math.min(...path.slice(1).map((pt, i) => distanceToSegment(p, path[i], pt)));

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
