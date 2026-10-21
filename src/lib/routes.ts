import type { Airport, CountryCode } from '../types';

/** One step travelled without flying, between two consecutive places. */
export type Hop = { a: Airport | undefined; b: Airport | undefined; planned: boolean };

/** A route that starts and ends in the home country. */
export const isDomestic = (a: Pick<Airport, 'country'> | undefined, b: Pick<Airport, 'country'> | undefined, home: CountryCode) =>
  a?.country === home && b?.country === home;

/**
 * The hops of a trip (one list per leg) that get a line when home routes are hidden: none inside the home
 * country, and none of a short trip that just goes out of it and back in two legs. Those lines clutter the
 * map around home without saying much.
 */
export function withoutHomeRoutes(legs: Hop[][], home: CountryCode): Hop[] {
  const [out, back] = legs;
  if (legs.length === 2 && out[0]?.a?.country === home && out.at(-1)?.b?.country !== home && back.at(-1)?.b?.country === home) return [];
  return legs.flat().filter((hop) => !isDomestic(hop.a, hop.b, home));
}

export interface SurfaceSegment {
  key: string;
  a: Airport;
  b: Airport;
  planned: boolean;
}

export interface SurfaceStop {
  place: Airport;
  planned: boolean;
}

/**
 * Lines and dots for travel without flying (one list of legs per trip, each a list of hops). With a `home`
 * country, home routes get no line (see withoutHomeRoutes), but their cities still get a dot. Places in
 * `skip` (already drawn as airports) get no dot. Lines and dots count as planned only when every trip
 * through them is planned.
 */
export function surfaceLayer(trips: Hop[][][], home: CountryCode | undefined, skip: Set<string>) {
  const segments = new Map<string, SurfaceSegment>();
  const stops = new Map<string, SurfaceStop>();
  for (const legs of trips) {
    const hops = legs.flat();
    const drawn = new Set(home ? withoutHomeRoutes(legs, home) : hops);
    for (const hop of hops) {
      const { a, b, planned } = hop;
      for (const p of [a, b]) {
        // A hidden connection's country marker isn't a city, so it gets no dot either.
        if (p && !skip.has(p.code) && (drawn.has(hop) || p.type !== 'K')) {
          stops.set(p.code, { place: p, planned: planned && (stops.get(p.code)?.planned ?? true) });
        }
      }
      if (!drawn.has(hop) || !a || !b) continue;
      const key = [a.code, b.code].sort().join('-');
      segments.set(key, { key, a, b, planned: planned && (segments.get(key)?.planned ?? true) });
    }
  }
  return { segments: [...segments.values()], stops: [...stops.values()] };
}
