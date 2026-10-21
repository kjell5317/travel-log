import type { Airport, Country, CountryBasis, CountryCode, IATA, Stop, TravelData, Trip } from '../types';
import { parseTripDate, type TripDate } from './dates';
import { plural } from './format';
import { distanceKm } from './geo';
import { CONTINENTS, countries, countryByCode, isCountryCode, type AirportLookup } from './reference';

export interface FlightInfo {
  /** 0-based position in the whole travel history. */
  index: number;
  tripIndex: number;
  tripId: string;
  /** Leg position inside its trip. */
  legIndex: number;
  /** Leg position in the whole history. */
  legNumber: number;
  /** Flight position inside its leg. */
  flightIndex: number;
  legFlights: number;
  from: IATA;
  to: IATA;
  fromAirport?: Airport;
  toAirport?: Airport;
  km: number | null;
  /** Total distance of all earlier flights. */
  kmBefore: number;
  planned: boolean;
}

export interface LegInfo {
  index: number;
  tripIndex: number;
  legIndex: number;
  codes: IATA[];
  firstFlight: number;
  planned: boolean;
}

/** A leg of a no-flight trip, or the part of a flight trip's leg that wasn't flown (train, bus, car, boat). */
export interface SurfaceLeg {
  tripIndex: number;
  legIndex: number;
  codes: IATA[];
  /** The places the codes stand for (undefined when unknown). */
  places: (Airport | undefined)[];
  /** Part of a no-flight trip, not of a flight trip. */
  noFlightTrip: boolean;
  planned: boolean;
}

type AnyLeg = { tripIndex: number; codes: IATA[]; noFlight: boolean; planned: boolean };

export interface AirportStat {
  code: IATA;
  airport?: Airport;
  /** Times you were at this airport (a connection counts once). */
  visits: number;
  departures: number;
  arrivals: number;
  /** Times you changed planes here without leaving the airport. */
  transfers: number;
  firstFlight: number;
  /** Only visited on planned trips. */
  planned: boolean;
}

/**
 * flight: a flown leg started or ended here; surface: a no-flight trip started or ended here;
 * home: your home country, no trip needed; manual: added by hand; transit: only passed through.
 */
export type VisitKind = 'flight' | 'surface' | 'home' | 'manual' | 'transit';

export interface CountryStat {
  code: CountryCode;
  country?: Country;
  kind: VisitKind;
  /** Number of flown legs that ended in this country. */
  arrivals: number;
  airports: IATA[];
  firstTrip: number | null;
  /** Not visited yet, only on planned trips. */
  planned: boolean;
  /** Your home country: visited from the start. */
  home: boolean;
}

export interface RouteStat {
  /** Airports sorted alphabetically: FRA–JFK and JFK–FRA are the same route. */
  key: string;
  a: IATA;
  b: IATA;
  count: number;
  km: number | null;
  flights: number[];
  /** All flights on this route are planned. */
  planned: boolean;
}

export interface TripStat {
  trip: Trip;
  index: number;
  noFlight: boolean;
  planned: boolean;
  date: TripDate | null;
  /** Countries visited for the first time on this trip. */
  newCountries: CountryCode[];
  legs: number;
  flights: number;
  km: number;
  countries: CountryCode[];
  firstFlight: number;
}

export interface TravelStats {
  flights: FlightInfo[];
  /** Flown legs only. */
  legs: LegInfo[];
  surfaceLegs: SurfaceLeg[];
  trips: TripStat[];
  airports: AirportStat[];
  airportByCode: Map<IATA, AirportStat>;
  routes: RouteStat[];
  /** Cities added by hand (outside trips), as places for the map. */
  extraPlaces: Airport[];
  /** Visited countries (by flight or added by hand), alphabetical. */
  countries: CountryStat[];
  /** Countries you only passed through. */
  transitOnly: CountryStat[];
  countryByCode: Map<CountryCode, CountryStat>;
  totalKm: number;
  unknownCodes: IATA[];
}

/**
 * A part of a leg. flown: one or more flights. surface: travelled without flying, drawn like a no-flight trip.
 * country: to or from a country code in a flight trip, counted but not drawn (also a lone country code).
 */
export interface LegPart {
  codes: IATA[];
  kind: 'flown' | 'surface' | 'country';
}

/**
 * Splits a leg into what you flew and what you didn't. A no-flight trip's leg is one surface part. In a
 * flight trip, a group of codes is a surface part, every connection to or from a country code is a
 * country part, and the runs of airports in between are flown.
 * E.g. FRA-BCN-AD-BCN-FRA → flown FRA-BCN, country BCN-AD, country AD-BCN, flown BCN-FRA;
 * (RVN-ALF)-OSL → surface RVN-ALF, flown ALF-OSL.
 */
export function splitLeg(leg: Stop[], noFlight = false): LegPart[] {
  const codes = leg.flat();
  if (noFlight) return [{ codes, kind: 'surface' }];
  if (codes.length === 1) return [{ codes, kind: 'country' }];
  // Whether each code was reached from the one before it inside a group.
  const grouped = leg.flatMap((stop) => (Array.isArray(stop) ? stop.map((_, i) => i > 0) : [false]));
  const parts: LegPart[] = [];
  for (let i = 1; i < codes.length; i++) {
    const kind = grouped[i] ? 'surface' : isCountryCode(codes[i - 1]) || isCountryCode(codes[i]) ? 'country' : 'flown';
    const last = parts.at(-1);
    // Connections of the same kind make one part, except that each one to or from a country stands alone.
    if (last?.kind === kind && kind !== 'country') last.codes.push(codes[i]);
    else parts.push({ codes: [codes[i - 1], codes[i]], kind });
  }
  return parts;
}

/** Done trips first, then planned ones; otherwise keeps the order. */
export function orderTrips<T extends { planned?: boolean }>(trips: T[]): T[] {
  return [...trips.filter((t) => !t.planned), ...trips.filter((t) => t.planned)];
}

/**
 * Statistics for the done trips, or (with `includePlanned`) for done and planned trips together.
 * `homeCountry` counts as visited before the first trip.
 */
export function computeStats(
  data: Pick<TravelData, 'trips' | 'extraCountries'> & Partial<Pick<TravelData, 'extraCities'>>,
  lookup: AirportLookup,
  { includePlanned = false, homeCountry }: { includePlanned?: boolean; homeCountry?: CountryCode } = {},
): TravelStats {
  const flights: FlightInfo[] = [];
  const legs: LegInfo[] = [];
  const surfaceLegs: SurfaceLeg[] = [];
  const allLegs: AnyLeg[] = [];
  const trips: TripStat[] = [];
  const unknown = new Set<IATA>();
  let kmSoFar = 0;

  orderTrips(includePlanned ? data.trips : data.trips.filter((t) => !t.planned)).forEach((trip, tripIndex) => {
    const noFlight = Boolean(trip.noFlight);
    const planned = Boolean(trip.planned);
    const tripStat: TripStat = {
      trip,
      index: tripIndex,
      noFlight,
      planned,
      date: parseTripDate(trip.date),
      newCountries: [],
      legs: trip.legs.length,
      flights: 0,
      km: 0,
      countries: [],
      firstFlight: flights.length,
    };
    const tripCountries = new Set<CountryCode>();
    trip.legs.forEach((leg, legIndex) => {
      for (const code of leg.flat()) if (!lookup(code)) unknown.add(code);
      // Every part counts its countries; only flown parts are flights, and parts to a country code aren't drawn.
      for (const { codes, kind } of splitLeg(leg, noFlight)) {
        addEnds(codes);
        allLegs.push({ tripIndex, codes, noFlight: kind !== 'flown', planned });
        if (kind === 'flown') flyLeg(codes, legIndex);
        else if (kind === 'surface') surfaceLegs.push({ tripIndex, legIndex, codes, places: codes.map(lookup), noFlightTrip: noFlight, planned });
      }
    });
    function addEnds(codes: IATA[]) {
      for (const end of [codes[0], codes.at(-1)!]) {
        const country = lookup(end)?.country;
        if (country) tripCountries.add(country);
      }
    }
    function flyLeg(codes: IATA[], legIndex: number) {
      const legNumber = legs.length;
      legs.push({ index: legNumber, tripIndex, legIndex, codes, firstFlight: flights.length, planned });
      for (let i = 0; i < codes.length - 1; i++) {
        const fromAirport = lookup(codes[i]);
        const toAirport = lookup(codes[i + 1]);
        const km = fromAirport && toAirport ? distanceKm(fromAirport, toAirport) : null;
        flights.push({
          index: flights.length,
          tripIndex,
          tripId: trip.id,
          legIndex,
          legNumber,
          flightIndex: i,
          legFlights: codes.length - 1,
          from: codes[i],
          to: codes[i + 1],
          fromAirport,
          toAirport,
          km,
          kmBefore: kmSoFar,
          planned,
        });
        kmSoFar += km ?? 0;
        tripStat.flights++;
        tripStat.km += km ?? 0;
      }
    }
    tripStat.countries = [...tripCountries];
    trips.push(tripStat);
  });

  const { airports, routes } = aggregate(legs, flights, lookup);
  // A city added by hand means its country was visited too.
  const extraPlaces: Airport[] = (data.extraCities ?? []).map((c) => ({ code: c.name, name: c.name, city: c.name, country: c.country, lat: c.lat, lon: c.lon, type: 'P' }));
  const countryStats = countryVisits(allLegs, [...data.extraCountries, ...extraPlaces.map((p) => p.country)], lookup, homeCountry);
  const all = [...countryStats.values()].sort((a, b) =>
    (a.country?.name ?? a.code).localeCompare(b.country?.name ?? b.code),
  );
  for (const c of all) if (c.kind !== 'transit' && c.firstTrip != null) trips[c.firstTrip].newCountries.push(c.code);

  return {
    flights,
    legs,
    surfaceLegs,
    extraPlaces,
    trips,
    airports,
    airportByCode: new Map(airports.map((a) => [a.code, a])),
    routes,
    countries: all.filter((c) => c.kind !== 'transit'),
    transitOnly: all.filter((c) => c.kind === 'transit'),
    countryByCode: countryStats,
    totalKm: kmSoFar,
    unknownCodes: [...unknown].sort(),
  };
}

/** Airport visit counts and routes for a set of legs (the whole history or one trip). */
export function aggregate(legs: LegInfo[], flights: FlightInfo[], lookup: AirportLookup) {
  const airportMap = new Map<IATA, AirportStat>();
  for (const leg of legs) {
    const last = leg.codes.length - 1;
    leg.codes.forEach((code, i) => {
      let stat = airportMap.get(code);
      if (!stat) {
        stat = {
          code,
          airport: lookup(code),
          visits: 0,
          departures: 0,
          arrivals: 0,
          transfers: 0,
          firstFlight: leg.firstFlight + Math.max(0, i - 1),
          planned: true,
        };
        airportMap.set(code, stat);
      }
      if (!leg.planned) stat.planned = false;
      stat.visits++;
      if (i < last) stat.departures++;
      if (i > 0) stat.arrivals++;
      if (i > 0 && i < last) stat.transfers++;
    });
  }

  const routeMap = new Map<string, RouteStat>();
  for (const f of flights) {
    const [a, b] = [f.from, f.to].sort();
    const key = `${a}-${b}`;
    let route = routeMap.get(key);
    if (!route) {
      route = { key, a, b, count: 0, km: f.km, flights: [], planned: true };
      routeMap.set(key, route);
    }
    if (!f.planned) route.planned = false;
    route.count++;
    route.flights.push(f.index);
  }

  return {
    airports: [...airportMap.values()].sort((x, y) => y.visits - x.visits || x.code.localeCompare(y.code)),
    routes: [...routeMap.values()].sort((x, y) => y.count - x.count || (y.km ?? 0) - (x.km ?? 0)),
  };
}

function countryVisits(legs: AnyLeg[], extraCountries: CountryCode[], lookup: AirportLookup, homeCountry?: CountryCode) {
  const stats = new Map<CountryCode, CountryStat>();
  const visitedNow = new Set<CountryCode>();
  const get = (code: CountryCode) => {
    let stat = stats.get(code);
    if (!stat) {
      stat = { code, country: countryByCode.get(code), kind: 'transit', arrivals: 0, airports: [], firstTrip: null, planned: false, home: false };
      stats.set(code, stat);
    }
    return stat;
  };
  if (homeCountry) {
    // Visited from the start: no trip "adds" it, so it never gets a first trip.
    Object.assign(get(homeCountry), { kind: 'home', home: true });
    visitedNow.add(homeCountry);
  }

  for (const leg of legs) {
    const last = leg.codes.length - 1;
    leg.codes.forEach((code, i) => {
      const endpoint = i === 0 || i === last;
      // Passing through somewhere on a future trip doesn't change anything yet.
      if (leg.planned && !endpoint) return;
      const country = lookup(code)?.country;
      if (!country) return;
      const stat = get(country);
      if (!leg.noFlight && !stat.airports.includes(code)) stat.airports.push(code);
      if (endpoint) {
        if (!leg.noFlight) stat.kind = 'flight';
        else if (stat.kind === 'transit' || stat.kind === 'home') stat.kind = 'surface';
        if (!stat.home) stat.firstTrip ??= leg.tripIndex;
        if (!leg.planned) visitedNow.add(country);
      }
      if (i === last && !leg.noFlight) stat.arrivals++;
    });
  }
  for (const code of extraCountries) {
    const stat = get(code);
    if (stat.kind === 'transit') stat.kind = 'manual';
    visitedNow.add(code);
  }
  for (const stat of stats.values()) stat.planned = stat.kind !== 'transit' && !visitedNow.has(stat.code);
  return stats;
}

/** One-line description of how (or whether) you visited a country. */
export function visitStatus(stat: CountryStat | undefined): string {
  if (stat?.home) return stat.arrivals ? `Home country · ${plural(stat.arrivals, 'arrival')} by plane` : 'Home country';
  if (stat?.planned) return 'Planned — not visited yet';
  switch (stat?.kind) {
    case 'flight':
      return stat.arrivals ? `Visited · ${plural(stat.arrivals, 'arrival')} by plane` : 'Visited';
    case 'surface':
      return 'Visited on a trip without flying';
    case 'manual':
      return 'Visited without a trip (added by hand)';
    case 'transit':
      return 'Transit only — you just passed through';
    default:
      return 'Not visited yet';
  }
}

const UN_AND_OBSERVERS = countries.filter((c) => c.un || c.observer);

export const BASIS_LABELS: Record<CountryBasis, string> = {
  'un+observers': 'UN members & observers',
  'un+observers+visited': 'Plus other places you visited',
};

export interface Coverage {
  visited: number;
  total: number;
  pct: number;
  /** Visited places that aren't UN members or observers (e.g. Hong Kong, Kosovo). */
  outside: CountryStat[];
  /** Whether `outside` is part of the visited/total counts. */
  outsideCounted: boolean;
  byContinent: { continent: string; name: string; visited: number; total: number }[];
}

export function coverage(visited: CountryStat[], basis: CountryBasis): Coverage {
  const baseCodes = new Set(UN_AND_OBSERVERS.map((c) => c.code));
  const outside = visited.filter((c) => !baseCodes.has(c.code) && c.country);
  const outsideCounted = basis === 'un+observers+visited';
  const base = outsideCounted ? [...UN_AND_OBSERVERS, ...outside.map((c) => c.country!)] : UN_AND_OBSERVERS;
  const visitedCodes = new Set(visited.map((c) => c.code));
  const count = base.filter((c) => visitedCodes.has(c.code)).length;
  const byContinent = Object.entries(CONTINENTS)
    .map(([continent, name]) => {
      const inContinent = base.filter((c) => c.continent === continent);
      return { continent, name, visited: inContinent.filter((c) => visitedCodes.has(c.code)).length, total: inContinent.length };
    })
    .filter((c) => c.total > 0);
  return {
    visited: count,
    total: base.length,
    pct: base.length ? (count / base.length) * 100 : 0,
    outside,
    outsideCounted,
    byContinent,
  };
}

export interface FlightPosition {
  number: number;
  total: number;
  /** Flights done up to and including this one. */
  done: number;
  after: number;
  donePct: number;
  afterPct: number;
  kmDonePct: number;
  kmAfterPct: number;
}

/** Where a flight sits in your history: how many flights (and how much distance) are done with it, and how many follow. */
export function flightPosition(stats: TravelStats, index: number): FlightPosition {
  const total = stats.flights.length;
  const flight = stats.flights[index];
  const done = index + 1;
  const after = total - done;
  const kmDone = flight.kmBefore + (flight.km ?? 0);
  return {
    number: done,
    total,
    done,
    after,
    donePct: (done / total) * 100,
    afterPct: (after / total) * 100,
    kmDonePct: stats.totalKm ? (kmDone / stats.totalKm) * 100 : 0,
    kmAfterPct: stats.totalKm ? ((stats.totalKm - kmDone) / stats.totalKm) * 100 : 0,
  };
}
