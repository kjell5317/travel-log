import { describe, expect, it } from 'vitest';
import { countryGrowth, flightMix, hoursInAir, records, tripsPerCountry } from './insights';
import { createAirportLookup } from './reference';
import { computeStats } from './stats';

const stats = computeStats(
  {
    trips: [
      { id: 'a', name: 'Munich', legs: [['HAM', 'MUC'], ['MUC', 'HAM']] },
      { id: 'b', name: 'Thailand', legs: [['HAM', 'DXB', 'BKK'], ['BKK', 'DXB', 'HAM']] },
      { id: 'c', name: 'Vienna', legs: [['HAM', 'VIE'], ['VIE', 'HAM']] },
    ],
    extraCountries: [],
  },
  createAirportLookup(),
);

describe('insights', () => {
  it('classifies flights by geography and distance', () => {
    const { where, distance } = flightMix(stats);
    expect(where.map((s) => s.count)).toEqual([2, 4, 2]);
    expect(distance.map((s) => s.count)).toEqual([4, 0, 4]);
  });

  it('tracks countries added per trip', () => {
    expect(countryGrowth(stats).map((p) => [p.total, p.added])).toEqual([
      [1, ['DE']],
      [2, ['TH']],
      [3, ['AT']],
    ]);
    expect(tripsPerCountry(stats)[0]).toEqual({ code: 'DE', trips: 3 });
  });

  it('starts the count with the home country', () => {
    const withHome = computeStats(
      {
        trips: [
          { id: 'a', name: 'Munich', legs: [['HAM', 'MUC'], ['MUC', 'HAM']] },
          { id: 'b', name: 'Thailand', legs: [['HAM', 'DXB', 'BKK'], ['BKK', 'DXB', 'HAM']] },
        ],
        extraCountries: [],
      },
      createAirportLookup(),
      { homeCountry: 'DE' },
    );
    expect(countryGrowth(withHome).map((p) => [p.total, p.added])).toEqual([
      [1, []],
      [2, ['TH']],
    ]);
  });

  it('places trips on a time axis when some have dates', () => {
    const dated = computeStats(
      {
        trips: [
          { id: 'a', name: 'A', legs: [['HAM', 'MUC']], date: '2018-Q1' },
          { id: 'b', name: 'B', legs: [['HAM', 'VIE']] },
          { id: 'c', name: 'C', legs: [['HAM', 'ZRH']], date: '2019-Q1' },
          { id: 'd', name: 'D', legs: [['HAM', 'CPH']], date: '2017' },
          { id: 'e', name: 'E', legs: [['HAM', 'OSL']] },
          { id: 'p', name: 'P', legs: [['HAM', 'LIS']], planned: true },
        ],
        extraCountries: [],
      },
      createAirportLookup(),
      { includePlanned: true },
    );
    const points = countryGrowth(dated, 2020.5);
    expect(points.map((p) => p.estimated)).toEqual([false, true, false, false, true, true]);
    const [a, b, c, d, e, p] = points.map((pt) => pt.time!);
    expect(a).toBeCloseTo(2018.125);
    expect(b).toBeCloseTo(2018.625); // halfway between A and C
    expect(c).toBeCloseTo(2019.125);
    expect(d).toBeCloseTo(2019.125); // dated before C although it came after: moved up
    expect(e).toBeCloseTo(2019.375); // one quarter after the last dated trip
    expect(p).toBeGreaterThan(2020.5); // planned and undated: after today
    expect(countryGrowth(stats).every((pt) => pt.time === null)).toBe(true);
  });

  it('estimates time in the air', () => {
    const km = stats.flights.reduce((n, f) => n + f.km!, 0);
    expect(hoursInAir(stats)).toBeCloseTo(km / 800 + 0.5 * stats.flights.length, 6);
  });

  it('finds records and extremes', () => {
    const byLabel = Object.fromEntries(records(stats).map((r) => [r.label, r]));
    expect(byLabel['Most flights in one leg'].detail).toBe('HAM → DXB → BKK');
    expect(byLabel['Northernmost'].detail).toContain('HAM');
    expect(byLabel['Southernmost'].detail).toContain('BKK');
    expect(byLabel['Farthest from HAM'].detail).toContain('BKK');
    expect(byLabel['Shortest flight'].detail).toBe('HAM → MUC');
  });
});
