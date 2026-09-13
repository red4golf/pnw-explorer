/**
 * Car-ferry crossings the routing service will not take.
 *
 * Not missing data. All four are in OpenStreetMap, connected to primary roads
 * at both docks, tagged for cars with a `duration`. The router refuses them
 * for two reasons, both verified on 12 September 2026 against the public OSRM
 * instance (routing.openstreetmap.de, profile "routability"):
 *
 * 1. OSRM weighs a ferry by its length at the profile's nominal 5 km/h, while
 *    the time it *reports* comes from the `duration` tag. Fauntleroy–Southworth
 *    is 7.7 km: a 30-minute sailing with a weight of 92, against a 91-minute
 *    road route with a weight of 91. The road wins by one point; the reverse
 *    direction, a few seconds longer by road, sails. Seattle–Bainbridge is
 *    13.4 km (weight 161 vs 127 by road), Seattle–Bremerton 25 km (301 vs 90).
 *    Every crossing the router does sail is one with no road alternative — an
 *    island — or a road alternative longer than that inflated weight.
 *
 * 2. Edmonds–Kingston would win on weight (108 vs 144) but the dock road at
 *    Edmonds is tagged `oneway=reversible`, which the car profile lists under
 *    `avoid` and treats as impassable, so the terminal cannot be reached.
 *
 * Neither can be fixed by editing OpenStreetMap; the first is the router's
 * profile and the second is a correct tag the profile chooses not to handle.
 * `exclude=ferry` is rejected by this instance and `alternatives=3` returns
 * the ferry only sometimes (Fauntleroy–Southworth yes, Seattle–Bainbridge no),
 * so the planner stitches these in itself as drive → sail → drive.
 *
 * Of nineteen crossings in the region the router sails fifteen — Mukilteo–
 * Clinton, the three Vashon runs, Point Defiance–Tahlequah, Coupeville–Port
 * Townsend, the San Juans, Anderson Island, Guemes, Lummi, the Coho, the
 * Wahkiakum ferry and the BC Ferries mainline — and its durations for those
 * include the sailing time. Only crossings it refuses belong here. Adding one
 * it already sails would not break anything — the stitched option simply
 * loses to the direct one — but it costs a table request per plan for no
 * answer.
 *
 * Sailing minutes are the scheduled crossing per WSF. Waits at the terminal
 * are not modelled anywhere; the UI says so. A WSDOT Traveler API key would
 * allow live sailings later — the `wsdotRouteId` is the hook for that.
 */
import type { Point } from './geo';

export interface Terminal extends Point {
  name: string;
}

export interface Crossing {
  id: string;
  /** Human label, "Seattle–Bainbridge". */
  name: string;
  a: Terminal;
  b: Terminal;
  /** Scheduled crossing time, minutes. */
  sailMinutes: number;
  /** WSDOT Ferries API route id, for live schedules if a key is ever wired in. */
  wsdotRouteId: number;
}

export const MISSING_CROSSINGS: readonly Crossing[] = [
  {
    id: 'sea-bi',
    name: 'Seattle–Bainbridge',
    a: { name: 'Seattle (Colman Dock)', lat: 47.6026, lng: -122.3393 },
    b: { name: 'Bainbridge Island', lat: 47.6229, lng: -122.511 },
    sailMinutes: 35,
    wsdotRouteId: 5,
  },
  {
    id: 'sea-br',
    name: 'Seattle–Bremerton',
    a: { name: 'Seattle (Colman Dock)', lat: 47.6026, lng: -122.3393 },
    b: { name: 'Bremerton', lat: 47.5622, lng: -122.625 },
    sailMinutes: 60,
    wsdotRouteId: 3,
  },
  {
    id: 'edm-kin',
    name: 'Edmonds–Kingston',
    a: { name: 'Edmonds', lat: 47.8113, lng: -122.383 },
    b: { name: 'Kingston', lat: 47.7963, lng: -122.4963 },
    sailMinutes: 30,
    wsdotRouteId: 6,
  },
  {
    id: 'fau-sou',
    name: 'Fauntleroy–Southworth',
    a: { name: 'Fauntleroy (West Seattle)', lat: 47.5232, lng: -122.3928 },
    b: { name: 'Southworth', lat: 47.5125, lng: -122.4956 },
    sailMinutes: 35,
    wsdotRouteId: 15,
  },
];

/** A crossing taken in a specific direction: board at `x`, land at `y`. */
export interface Sailing {
  crossing: Crossing;
  x: Terminal;
  y: Terminal;
}

/** Every crossing in both directions. */
export const sailings = (crossings: readonly Crossing[] = MISSING_CROSSINGS): Sailing[] =>
  crossings.flatMap((crossing) => [
    { crossing, x: crossing.a, y: crossing.b },
    { crossing, x: crossing.b, y: crossing.a },
  ]);
