/**
 * Car-ferry crossings the routing service does not know about.
 *
 * Measured against the public OSRM instance on 12 September 2026 by asking
 * for a terminal-to-terminal route and checking for a `mode: "ferry"` step
 * (scripts are not kept; the numbers are in ARCHITECTURE.md). Of nineteen
 * crossings in the region it sails fifteen — Mukilteo–Clinton, the three
 * Vashon runs, Point Defiance–Tahlequah, Coupeville–Port Townsend, the San
 * Juans, Anderson Island, Guemes, Lummi, the Coho, the Wahkiakum ferry and the
 * BC Ferries mainline — and its durations for those include the sailing time.
 *
 * It does NOT sail the four below. For each it drives around the Sound
 * instead, which is not an approximation but a different trip: Seattle to
 * Bainbridge comes out at 127 minutes and 92 miles for a 35-minute crossing.
 * The planner stitches these in itself as drive → sail → drive.
 *
 * Only crossings the router lacks belong here. Adding one it already sails
 * would not break anything — the stitched option simply loses to the direct
 * one — but it costs a table request per plan for no answer.
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
