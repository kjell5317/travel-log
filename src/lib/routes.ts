import type { Airport, CountryCode } from '../types';

/** One step travelled without flying, between two consecutive places. */
export type Hop = { a: Airport | undefined; b: Airport | undefined; planned: boolean };

/**
 * Drops the way out of the home country at the start of a no-flight trip and the way back at its end
 * (plus any travel inside the home country before leaving / after returning): those lines all
 * converge on home and only clutter the map. Trips that stay inside the home country are kept.
 */
export function withoutHomeConnections(hops: Hop[], home: CountryCode): Hop[] {
  // Way out: the leading hops that start at home, up to the first one that crosses the border.
  let leading = 0;
  while (leading < hops.length && hops[leading].a?.country === home) leading++;
  const out = hops.findIndex((hop, i) => i < leading && hop.b && hop.b.country !== home);
  const from = out === -1 ? 0 : out + 1;

  // Way home: the trailing hops that end at home, from the last one that crosses the border.
  let trailing = hops.length;
  while (trailing > 0 && hops[trailing - 1].b?.country === home) trailing--;
  const back = hops.findIndex((hop, i) => i >= trailing && hop.a && hop.a.country !== home);
  const to = back === -1 ? hops.length : back;

  return from < to ? hops.slice(from, to) : [];
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
 * Lines and dots for no-flight trips (one list of hops per trip). The way out of / back into the home
 * country gets no line, but its cities still get a dot. `kept` hops (travel without flying inside flight
 * trips) are always drawn. Places in `skip` (already drawn as airports) get no dot. Lines and dots count
 * as planned only when every trip through them is planned.
 */
export function surfaceLayer(trips: Hop[][], home: CountryCode | undefined, skip: Set<string>, kept: Hop[][] = []) {
  const segments = new Map<string, SurfaceSegment>();
  const stops = new Map<string, SurfaceStop>();
  const add = (hops: Hop[], drawn: Set<Hop>) => {
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
  };
  for (const hops of trips) add(hops, new Set(home ? withoutHomeConnections(hops, home) : hops));
  for (const hops of kept) add(hops, new Set(hops));
  return { segments: [...segments.values()], stops: [...stops.values()] };
}
