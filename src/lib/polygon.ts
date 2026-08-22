/**
 * Ray-casting point-in-polygon test.
 *
 * Separate from concierge.ts so the geometry can be unit-reasoned about on its
 * own and reused by any future geofence (a second service area, a park
 * boundary, a "this entry is inside a national park" badge).
 *
 * Polygons are [lat, lng] pairs and are treated as closed — the last vertex is
 * joined back to the first automatically.
 */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: ReadonlyArray<readonly [number, number]>
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    const straddles = lngI > lng !== lngJ > lng;
    if (straddles && lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI) {
      inside = !inside;
    }
  }
  return inside;
}
