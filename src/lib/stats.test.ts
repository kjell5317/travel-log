import { describe, expect, it } from 'vitest';
import type { Airport } from '../types';
import { computeStats, coverage, flightPosition, splitLeg } from './stats';
import { createAirportLookup } from './reference';

const lookup = createAirportLookup();

const data = {
  trips: [
    { id: 't1', name: 'Thailand', legs: [['FRA', 'DXB', 'BKK'], ['BKK', 'DXB', 'FRA']] },
    { id: 't2', name: 'New York', legs: [['FRA', 'JFK'], ['JFK', 'FRA']] },
  ],
  extraCountries: ['AT'],
};

describe('computeStats', () => {
  const stats = computeStats(data, lookup);

  it('numbers flights in trip → leg → flight order', () => {
    expect(stats.flights.map((f) => `${f.from}-${f.to}`)).toEqual([
      'FRA-DXB',
      'DXB-BKK',
      'BKK-DXB',
      'DXB-FRA',
      'FRA-JFK',
      'JFK-FRA',
    ]);
    expect(stats.legs).toHaveLength(4);
    expect(stats.flights[3]).toMatchObject({ tripIndex: 0, legIndex: 1, flightIndex: 1, legFlights: 2 });
  });

  it('counts airport visits with a connection counting once', () => {
    const dxb = stats.airportByCode.get('DXB')!;
    expect(dxb).toMatchObject({ visits: 2, departures: 2, arrivals: 2, transfers: 2 });
    const fra = stats.airportByCode.get('FRA')!;
    expect(fra).toMatchObject({ visits: 4, departures: 2, arrivals: 2, transfers: 0, firstFlight: 0 });
    expect(stats.airportByCode.get('BKK')!.firstFlight).toBe(1);
  });

  it('treats transfer-only countries as transit, not visited', () => {
    expect(stats.countries.map((c) => c.code).sort()).toEqual(['AT', 'DE', 'TH', 'US']);
    expect(stats.transitOnly.map((c) => c.code)).toEqual(['AE']);
    expect(stats.countryByCode.get('AT')!.kind).toBe('manual');
    expect(stats.countryByCode.get('TH')!.arrivals).toBe(1);
  });

  it('merges both directions into one route', () => {
    const route = stats.routes.find((r) => r.key === 'DXB-FRA')!;
    expect(route.count).toBe(2);
    expect(route.flights).toEqual([0, 3]);
  });

  it('counts the selected flight as done', () => {
    const pos = flightPosition(stats, 2);
    expect(pos).toMatchObject({ number: 3, total: 6, done: 3, after: 3, donePct: 50, afterPct: 50 });
    const first = flightPosition(stats, 0);
    expect(first.done).toBe(1);
    expect(first.kmDonePct).toBeCloseTo((stats.flights[0].km! / stats.totalKm) * 100, 6);
    const last = flightPosition(stats, 5);
    expect(last).toMatchObject({ donePct: 100, afterPct: 0 });
    expect(last.kmDonePct).toBeCloseTo(100, 6);
    expect(last.kmAfterPct).toBeCloseTo(0, 6);
  });

  it('counts countries of no-flight trips but not their legs as flights or airports', () => {
    const s = computeStats(
      {
        trips: [
          { id: 'a', name: 'Interrail', legs: [['HAM', 'CPH', 'OSL']], noFlight: true },
          { id: 'b', name: 'Oslo', legs: [['OSL', 'HAM']] },
        ],
        extraCountries: [],
      },
      lookup,
    );
    expect(s.flights).toHaveLength(1);
    expect(s.legs).toHaveLength(1);
    expect(s.surfaceLegs).toMatchObject([{ tripIndex: 0, codes: ['HAM', 'CPH', 'OSL'] }]);
    expect(s.surfaceLegs[0].places.map((p) => p?.country)).toEqual(['DE', 'DK', 'NO']);
    expect(s.airports.map((a) => a.code).sort()).toEqual(['HAM', 'OSL']);
    expect(s.countryByCode.get('NO')).toMatchObject({ kind: 'flight', firstTrip: 0, arrivals: 0 });
    expect(s.countryByCode.get('DE')).toMatchObject({ kind: 'flight', arrivals: 1 });
    expect(s.countryByCode.get('DK')!.kind).toBe('transit');
    expect(s.trips[0]).toMatchObject({ noFlight: true, flights: 0 });

    const onlySurface = computeStats({ trips: [{ id: 'a', name: '', legs: [['HAM', 'CPH']], noFlight: true }], extraCountries: ['DK'] }, lookup);
    expect(onlySurface.countryByCode.get('DK')!.kind).toBe('surface');
    expect(onlySurface.countries.map((c) => c.code).sort()).toEqual(['DE', 'DK']);
  });

  it('leaves planned trips out unless asked, and puts them after done trips', () => {
    const withPlan = {
      trips: [
        { id: 'p', name: 'Japan', legs: [['FRA', 'HEL', 'NRT']], planned: true },
        { id: 'a', name: 'NYC', legs: [['FRA', 'JFK'], ['JFK', 'FRA']] },
      ],
      extraCountries: [],
    };
    const now = computeStats(withPlan, lookup);
    expect(now.trips.map((t) => t.trip.id)).toEqual(['a']);
    expect(now.countries.map((c) => c.code).sort()).toEqual(['DE', 'US']);

    const all = computeStats(withPlan, lookup, { includePlanned: true });
    expect(all.trips.map((t) => [t.trip.id, t.planned])).toEqual([
      ['a', false],
      ['p', true],
    ]);
    expect(all.flights.map((f) => [f.index, f.planned])).toEqual([
      [0, false],
      [1, false],
      [2, true],
      [3, true],
    ]);
    expect(all.countryByCode.get('JP')).toMatchObject({ kind: 'flight', planned: true, firstTrip: 1 });
    expect(all.countryByCode.get('DE')!.planned).toBe(false);
    // Changing planes on a planned trip doesn't mark the country yet.
    expect(all.countryByCode.has('FI')).toBe(false);
    expect(all.airportByCode.get('NRT')!.planned).toBe(true);
    expect(all.airportByCode.get('FRA')!.planned).toBe(false);
    expect(all.routes.find((r) => r.key === 'FRA-HEL')!.planned).toBe(true);
    expect(all.trips.map((t) => t.newCountries)).toEqual([['DE', 'US'], ['JP']]);
  });

  it('counts the home country from the start, without a first trip', () => {
    const s = computeStats(
      { trips: [{ id: 'a', name: 'NYC', legs: [['FRA', 'JFK'], ['JFK', 'FRA']] }], extraCountries: ['DE'] },
      lookup,
      { homeCountry: 'DE' },
    );
    expect(s.countryByCode.get('DE')).toMatchObject({ home: true, kind: 'flight', firstTrip: null, arrivals: 1, planned: false });
    expect(s.trips[0].newCountries).toEqual(['US']);
    const noTrips = computeStats({ trips: [], extraCountries: [] }, lookup, { homeCountry: 'DE' });
    expect(noTrips.countries.map((c) => [c.code, c.kind])).toEqual([['DE', 'home']]);
  });

  it('counts the country of a city added by hand', () => {
    const s = computeStats(
      { trips: [], extraCountries: [], extraCities: [{ name: 'Heidelberg', country: 'DE', lat: 49.41, lon: 8.69 }] },
      lookup,
    );
    expect(s.countryByCode.get('DE')).toMatchObject({ kind: 'manual' });
    expect(s.extraPlaces).toMatchObject([{ name: 'Heidelberg', country: 'DE', type: 'P' }]);
  });

  it('splits flight legs where they touch a country code', () => {
    expect(splitLeg(['FRA', 'BCN', 'AD', 'BCN', 'FRA'])).toEqual([
      { codes: ['FRA', 'BCN'], kind: 'flown' },
      { codes: ['BCN', 'AD'], kind: 'country' },
      { codes: ['AD', 'BCN'], kind: 'country' },
      { codes: ['BCN', 'FRA'], kind: 'flown' },
    ]);
    expect(splitLeg(['AD'])).toEqual([{ codes: ['AD'], kind: 'country' }]);
    expect(splitLeg(['FRA', 'DXB', 'BKK'])).toEqual([{ codes: ['FRA', 'DXB', 'BKK'], kind: 'flown' }]);
  });

  it('splits flight legs around groups travelled without flying', () => {
    expect(splitLeg([['RVN', 'ALF'], 'OSL'])).toEqual([
      { codes: ['RVN', 'ALF'], kind: 'surface' },
      { codes: ['ALF', 'OSL'], kind: 'flown' },
    ]);
    expect(splitLeg(['FRA', ['MUC', 'LI', 'ZRH'], 'LHR', 'JFK'])).toEqual([
      { codes: ['FRA', 'MUC'], kind: 'flown' },
      { codes: ['MUC', 'LI', 'ZRH'], kind: 'surface' },
      { codes: ['ZRH', 'LHR', 'JFK'], kind: 'flown' },
    ]);
    expect(splitLeg([['RVN', 'ALF']])).toEqual([{ codes: ['RVN', 'ALF'], kind: 'surface' }]);
    expect(splitLeg([['HAM', 'CPH'], ['OSL', 'BGO']])).toEqual([
      { codes: ['HAM', 'CPH'], kind: 'surface' },
      { codes: ['CPH', 'OSL'], kind: 'flown' },
      { codes: ['OSL', 'BGO'], kind: 'surface' },
    ]);
    // A no-flight trip's leg is one part, whatever its groups.
    expect(splitLeg([['RVN', 'ALF'], 'OSL'], true)).toEqual([{ codes: ['RVN', 'ALF', 'OSL'], kind: 'surface' }]);
  });

  it('counts groups in flight trips like no-flight trips', () => {
    const s = computeStats(
      { trips: [{ id: 'a', name: 'Lapland', legs: [['OSL', 'RVN'], [['RVN', 'ALF'], 'OSL']] }], extraCountries: [] },
      lookup,
      { homeCountry: 'NO' },
    );
    expect(s.flights.map((f) => `${f.from}-${f.to}`)).toEqual(['OSL-RVN', 'ALF-OSL']);
    expect(s.flights[1]).toMatchObject({ legIndex: 1, flightIndex: 0, legFlights: 1 });
    expect(s.legs.map((l) => l.codes)).toEqual([['OSL', 'RVN'], ['ALF', 'OSL']]);
    expect(s.surfaceLegs).toMatchObject([{ tripIndex: 0, legIndex: 1, codes: ['RVN', 'ALF'], noFlightTrip: false }]);
    expect(s.airportByCode.get('RVN')).toMatchObject({ visits: 1, departures: 0, arrivals: 1 });
    expect(s.airportByCode.get('ALF')).toMatchObject({ visits: 1, departures: 1, arrivals: 0 });
    expect(s.countryByCode.get('FI')).toMatchObject({ kind: 'flight', arrivals: 1 });
    expect(s.trips[0]).toMatchObject({ legs: 2, flights: 2 });

    const byCar = computeStats({ trips: [{ id: 'a', name: '', legs: [['HEL', 'RVN'], [['RVN', 'ALF']]] }], extraCountries: [] }, lookup);
    expect(byCar.countryByCode.get('NO')).toMatchObject({ kind: 'surface', arrivals: 0, airports: [] });
  });

  it('counts country codes in flight trips without making them flights', () => {
    const s = computeStats(
      { trips: [{ id: 'a', name: 'Spain', legs: [['FRA', 'BCN', 'AD'], ['SM'], ['BCN', 'FRA']] }], extraCountries: [] },
      lookup,
    );
    expect(s.flights.map((f) => `${f.from}-${f.to}`)).toEqual(['FRA-BCN', 'BCN-FRA']);
    expect(s.airports.map((a) => a.code).sort()).toEqual(['BCN', 'FRA']);
    expect(s.airportByCode.get('BCN')).toMatchObject({ visits: 2, transfers: 0 });
    expect(s.surfaceLegs).toEqual([]);
    expect(s.countryByCode.get('AD')).toMatchObject({ kind: 'surface', firstTrip: 0 });
    expect(s.countryByCode.get('SM')).toMatchObject({ kind: 'surface' });
    expect(s.countryByCode.get('ES')!.kind).toBe('flight');
    expect(s.trips[0].newCountries.sort()).toEqual(['AD', 'DE', 'ES', 'SM']);
  });

  it('places 2-letter country codes of no-flight trips in the middle of the country', () => {
    const s = computeStats({ trips: [{ id: 'a', name: 'Alps', legs: [['MUC', 'LI'], ['LI', 'ZRH']], noFlight: true }], extraCountries: [] }, lookup);
    const li = s.surfaceLegs[0].places[1]!;
    expect(li).toMatchObject({ code: 'LI', type: 'K', country: 'LI', name: 'Liechtenstein' });
    expect(li.lat).toBeCloseTo(47.27, 1);
    expect(s.countryByCode.get('LI')).toMatchObject({ kind: 'surface', planned: false });
    expect(s.unknownCodes).toEqual([]);
  });

  it('measures great-circle distances', () => {
    const fraJfk = stats.flights[4].km!;
    expect(fraJfk).toBeGreaterThan(6150);
    expect(fraJfk).toBeLessThan(6250);
  });

  it('flags unknown airports without crashing', () => {
    const s = computeStats({ trips: [{ id: 'x', name: '', legs: [['FRA', 'QQQ']] }], extraCountries: [] }, lookup);
    expect(s.unknownCodes).toEqual(['QQQ']);
    expect(s.flights[0].km).toBeNull();
  });

  it('uses custom airports', () => {
    const custom: Record<string, Omit<Airport, 'code' | 'type'>> = {
      QQQ: { name: 'Test Field', city: 'Testville', country: 'IS', lat: 64, lon: -22 },
    };
    const s = computeStats({ trips: [{ id: 'x', name: '', legs: [['FRA', 'QQQ']] }], extraCountries: [] }, createAirportLookup(custom));
    expect(s.unknownCodes).toEqual([]);
    expect(s.countries.map((c) => c.code).sort()).toEqual(['DE', 'IS']);
  });
});

describe('coverage', () => {
  const stats = computeStats(data, lookup);
  it('counts against the 195 UN members and observers', () => {
    const cov = coverage(stats.countries, 'un+observers');
    expect(cov.total).toBe(195);
    expect(cov.visited).toBe(4);
    expect(cov.byContinent.reduce((n, c) => n + c.total, 0)).toBe(195);
  });
  it('adds other visited places to both counts when asked', () => {
    const s = computeStats({ trips: [{ id: 'x', name: '', legs: [['FRA', 'HKG']] }], extraCountries: ['XK'] }, lookup);
    const un = coverage(s.countries, 'un+observers');
    expect(un).toMatchObject({ visited: 1, total: 195, outsideCounted: false });
    expect(un.outside.map((c) => c.code).sort()).toEqual(['HK', 'XK']);
    const all = coverage(s.countries, 'un+observers+visited');
    expect(all).toMatchObject({ visited: 3, total: 197, outsideCounted: true });
    expect(all.pct).toBeCloseTo((3 / 197) * 100, 6);
    expect(all.byContinent.reduce((n, c) => n + c.total, 0)).toBe(197);
  });
});
