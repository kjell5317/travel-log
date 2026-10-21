import type { Airport, CountryCode, Selection } from '../types';
import { dateValue, todayValue } from './dates';
import { fmtInt, fmtKm, plural } from './format';
import { distanceKm } from './geo';
import { CONTINENTS, countryByCode } from './reference';
import type { TravelStats, TripStat } from './stats';

/** Rough block time: cruise at ~800 km/h plus half an hour for taxi, climb and descent. */
const CRUISE_KMH = 800;
const GROUND_HOURS = 0.5;

export function hoursInAir(stats: TravelStats): number {
  return stats.flights.reduce((h, f) => (f.km == null ? h : h + f.km / CRUISE_KMH + GROUND_HOURS), 0);
}

export interface Share {
  label: string;
  hint: string;
  count: number;
}

/** How far and how "foreign" your flights were. */
export function flightMix(stats: TravelStats): { where: Share[]; distance: Share[] } {
  const where = { domestic: 0, continental: 0, intercontinental: 0 };
  const distance = { short: 0, medium: 0, long: 0 };
  for (const f of stats.flights) {
    const a = f.fromAirport;
    const b = f.toAirport;
    if (a && b) {
      if (a.country === b.country) where.domestic++;
      else if (countryByCode.get(a.country)?.continent === countryByCode.get(b.country)?.continent) where.continental++;
      else where.intercontinental++;
    }
    if (f.km != null) {
      if (f.km < 1500) distance.short++;
      else if (f.km <= 4000) distance.medium++;
      else distance.long++;
    }
  }
  return {
    where: [
      { label: 'Domestic', hint: 'within one country', count: where.domestic },
      { label: 'Within a continent', hint: 'to another country', count: where.continental },
      { label: 'Intercontinental', hint: 'to another continent', count: where.intercontinental },
    ],
    distance: [
      { label: 'Short-haul', hint: 'under 1,500 km', count: distance.short },
      { label: 'Medium-haul', hint: '1,500–4,000 km', count: distance.medium },
      { label: 'Long-haul', hint: 'over 4,000 km', count: distance.long },
    ],
  };
}

export interface GrowthPoint {
  trip: TripStat;
  /** Countries visited after this trip (trip countries only, not ones added by hand). */
  total: number;
  added: CountryCode[];
  /** Position in years (e.g. 2019.625), or null when no trip has a date. */
  time: number | null;
  /** The trip has no date; its time is placed between its neighbours. */
  estimated: boolean;
}

/** Assumed gap between undated trips before the first / after the last dated one. */
const UNDATED_STEP = 0.25;

/**
 * Countries visited after each trip. Dated trips sit in their quarter; undated ones are spread
 * evenly between the dated trips around them, done trips never after today and planned ones never before.
 */
export function countryGrowth(stats: TravelStats, today = todayValue()): GrowthPoint[] {
  // The home country counts before the first trip.
  const home = stats.countries.filter((c) => c.home).length;
  const known = stats.trips.map((t) => (t.date ? dateValue(t.date) : null));
  // Trips are in order, so a date earlier than a previous trip's is moved up to it.
  let latest = -Infinity;
  known.forEach((v, i) => {
    if (v != null) known[i] = latest = Math.max(v, latest);
  });
  const anchors = known.flatMap((v, i) => (v == null ? [] : [i]));

  let total = home;
  let previousTime = -Infinity;
  let plannedRank = 0;
  return stats.trips.map((trip, i) => {
    total += trip.newCountries.length;
    let time: number | null = null;
    if (anchors.length) {
      if (known[i] != null) time = known[i];
      else {
        const prev = anchors.findLast((a) => a < i);
        const next = anchors.find((a) => a > i);
        if (prev != null && next != null) time = known[prev]! + ((known[next]! - known[prev]!) * (i - prev)) / (next - prev);
        else if (next != null) time = known[next]! - UNDATED_STEP * (next - i);
        else time = known[prev!]! + UNDATED_STEP * (i - prev!);
        if (!trip.planned) time = Math.min(time, today);
        else if (time < today) time = today + UNDATED_STEP * (plannedRank + 1);
      }
      time = previousTime = Math.max(time, previousTime);
    }
    if (trip.planned) plannedRank++;
    return { trip, total, added: trip.newCountries, time, estimated: known[i] == null };
  });
}

/** Continents with at least one visited country. */
export function continentsVisited(stats: TravelStats): string[] {
  const visited = new Set(stats.countries.map((c) => c.country?.continent).filter(Boolean) as string[]);
  return Object.keys(CONTINENTS).filter((c) => visited.has(c));
}

/** Countries ranked by how many trips started or ended there. */
export function tripsPerCountry(stats: TravelStats): { code: CountryCode; trips: number }[] {
  const counts = new Map<CountryCode, number>();
  for (const t of stats.trips) for (const c of t.countries) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()]
    .map(([code, trips]) => ({ code, trips }))
    .sort((a, b) => b.trips - a.trips || (countryByCode.get(a.code)?.name ?? a.code).localeCompare(countryByCode.get(b.code)?.name ?? b.code));
}

export interface RecordItem {
  label: string;
  value: string;
  detail: string;
  show?: Selection;
}

const placeName = (a: Airport) => `${a.code} · ${a.city || a.name}, ${countryByCode.get(a.country)?.name ?? a.country}`;
const degrees = (value: number, pos: string, neg: string) => `${Math.abs(value).toFixed(1)}° ${value >= 0 ? pos : neg}`;

export function records(stats: TravelStats): RecordItem[] {
  const items: RecordItem[] = [];
  const measured = stats.flights.filter((f) => f.km != null);
  if (measured.length) {
    const longest = measured.reduce((a, b) => (b.km! > a.km! ? b : a));
    const shortest = measured.reduce((a, b) => (b.km! < a.km! ? b : a));
    items.push({ label: 'Longest flight', value: fmtKm(longest.km), detail: `${longest.from} → ${longest.to}`, show: { kind: 'flight', index: longest.index } });
    items.push({ label: 'Shortest flight', value: fmtKm(shortest.km), detail: `${shortest.from} → ${shortest.to}`, show: { kind: 'flight', index: shortest.index } });
  }

  const flown = stats.trips.filter((t) => !t.noFlight && t.flights > 0);
  if (flown.length) {
    const farthest = flown.reduce((a, b) => (b.km > a.km ? b : a));
    items.push({ label: 'Longest trip', value: fmtKm(farthest.km), detail: farthest.trip.name || `Trip ${farthest.index + 1}` });
  }
  // Every there-and-back trip touches two countries, so this is only a record from three on.
  const widest = stats.trips.reduce<TripStat | null>((a, b) => (!a || b.countries.length > a.countries.length ? b : a), null);
  if (widest && widest.countries.length >= 3) {
    items.push({ label: 'Most countries in one trip', value: fmtInt(widest.countries.length), detail: widest.trip.name || `Trip ${widest.index + 1}` });
  }
  if (stats.legs.length) {
    const longestLeg = stats.legs.reduce((a, b) => (b.codes.length > a.codes.length ? b : a));
    if (longestLeg.codes.length > 2) {
      items.push({
        label: 'Most flights in one leg',
        value: plural(longestLeg.codes.length - 1, 'flight'),
        detail: longestLeg.codes.join(' → '),
        show: { kind: 'flight', index: longestLeg.firstFlight },
      });
    }
  }

  const places = new Map<string, Airport>();
  for (const a of stats.airports) if (a.airport) places.set(a.code, a.airport);
  // A country's centre isn't a place you were, so it doesn't count for extremes.
  for (const leg of stats.surfaceLegs) for (const p of leg.places) if (p && p.type !== 'K') places.set(p.code, p);
  for (const p of stats.extraPlaces) places.set(`city:${p.name}|${p.country}`, p);
  const all = [...places.values()];
  if (all.length) {
    const pick = (better: (a: Airport, b: Airport) => boolean) => all.reduce((a, b) => (better(b, a) ? b : a));
    const north = pick((a, b) => a.lat > b.lat);
    const south = pick((a, b) => a.lat < b.lat);
    const east = pick((a, b) => a.lon > b.lon);
    const west = pick((a, b) => a.lon < b.lon);
    const extremes: [string, Airport, string][] = [
      ['Northernmost', north, degrees(north.lat, 'N', 'S')],
      ['Southernmost', south, degrees(south.lat, 'N', 'S')],
      ['Easternmost', east, degrees(east.lon, 'E', 'W')],
      ['Westernmost', west, degrees(west.lon, 'E', 'W')],
    ];
    for (const [label, place, value] of extremes) {
      items.push({
        label,
        value,
        detail: placeName(place),
        show: stats.airportByCode.has(place.code) ? { kind: 'airport', code: place.code } : undefined,
      });
    }
  }

  const home = stats.airports[0]?.airport;
  if (home && all.length > 1) {
    const far = all.reduce((a, b) => (distanceKm(home, b) > distanceKm(home, a) ? b : a));
    items.push({
      label: `Farthest from ${home.code}`,
      value: fmtKm(distanceKm(home, far)),
      detail: placeName(far),
      show: stats.airportByCode.has(far.code) ? { kind: 'airport', code: far.code } : undefined,
    });
  }
  return items;
}
