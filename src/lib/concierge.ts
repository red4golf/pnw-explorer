/**
 * Bainbridge Concierge targeting.
 *
 * The concierge itself is an ElevenLabs voice agent reached by phone and lives
 * entirely outside this codebase. All this site does is decide which pages are
 * allowed to mention it.
 *
 * That decision is a geofence rather than a site-wide banner on purpose: the
 * service only covers Bainbridge Island, and advertising it on a page about
 * Crater Lake trains readers to ignore it. The previous build shipped it
 * site-wide, then contextually, then dialled it back again — the geofence is
 * where that ended up, so it is where this one starts.
 */
import { pointInPolygon } from './polygon';

/** Bainbridge Island and its immediate waters, as a closed polygon. */
export const BAINBRIDGE_GEOFENCE: ReadonlyArray<readonly [number, number]> = [
  [47.486, -122.535],
  [47.515, -122.61],
  [47.62, -122.645],
  [47.73, -122.585],
  [47.76, -122.5],
  [47.72, -122.425],
  [47.6, -122.415],
  [47.5, -122.465],
];

export interface ConciergeTarget {
  coordinates: { lat: number; lng: number };
  title?: string | null;
  address?: string | null;
}

/**
 * Inside the polygon, or named as Bainbridge in the title or address.
 *
 * The text check is a deliberate second net: a handful of island entries carry
 * coordinates for a viewpoint or a ferry dock that sits just off the polygon
 * edge, and those are exactly the pages a visitor to the island is reading.
 */
export function isBainbridge(loc: ConciergeTarget): boolean {
  if (pointInPolygon(loc.coordinates.lat, loc.coordinates.lng, BAINBRIDGE_GEOFENCE)) return true;
  return /bainbridge island/i.test(`${loc.title ?? ''} ${loc.address ?? ''}`);
}

/** tel: href for a display phone number, or null when none is configured. */
export const telHref = (phone: string | null | undefined): string | null =>
  phone ? `tel:${phone.replace(/[^+\d]/g, '')}` : null;
