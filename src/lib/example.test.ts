import { describe, expect, it } from 'vitest';
import { exampleData } from './store';
import { createAirportLookup, isCountryCode } from './reference';
import { computeStats } from './stats';

describe('example data', () => {
  const data = exampleData();
  const stats = computeStats(data, createAirportLookup(data.customAirports), { includePlanned: true, homeCountry: data.settings.homeCountry });

  it('only uses known codes', () => {
    expect(stats.unknownCodes).toEqual([]);
  });

  it('shows every feature', () => {
    expect(data.trips.some((t) => t.noFlight)).toBe(true);
    expect(data.trips.some((t) => t.planned)).toBe(true);
    expect(data.trips.some((t) => t.date)).toBe(true);
    expect(data.trips.some((t) => !t.date)).toBe(true);
    expect(data.trips.some((t) => !t.noFlight && t.legs.some((leg) => leg.flat().some(isCountryCode)))).toBe(true);
    expect(data.trips.some((t) => t.noFlight && t.legs.some((leg) => leg.flat().some(isCountryCode)))).toBe(true);
    expect(data.trips.some((t) => !t.noFlight && t.legs.some((leg) => leg.some(Array.isArray)))).toBe(true);
    expect(data.extraCities.length).toBeGreaterThan(0);
    expect(data.extraCountries.length).toBeGreaterThan(0);
    expect(data.settings.homeCountry).toBeTruthy();
    expect(stats.countries.some((c) => c.planned)).toBe(true);
  });
});
