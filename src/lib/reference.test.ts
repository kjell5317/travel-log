import { describe, expect, it } from 'vitest';
import { bundledAirport, searchAirports, searchCities, searchCountries } from './reference';

const codes = (query: string, exclude?: Set<string>) => searchCountries(query, exclude).map((c) => c.code);

describe('searchCountries', () => {
  it('ranks name prefixes first', () => {
    expect(codes('aus').slice(0, 2)).toEqual(['AU', 'AT']);
    expect(codes('swi')[0]).toBe('CH');
  });

  it('finds countries by alternative names and ignores accents', () => {
    expect(codes('usa')[0]).toBe('US');
    expect(codes('uk')).toContain('GB');
    expect(codes('holland')[0]).toBe('NL');
    expect(codes('ivory')[0]).toBe('CI');
    expect(codes('cote')[0]).toBe('CI');
  });

  it('matches words inside the name', () => {
    expect(codes('korea')).toEqual(expect.arrayContaining(['KR', 'KP']));
  });

  it('leaves out excluded countries', () => {
    expect(codes('aus', new Set(['AU']))[0]).toBe('AT');
  });

  it('returns nothing for an empty query', () => {
    expect(codes('  ')).toEqual([]);
  });
});

describe('searchCities', () => {
  it('finds cities by name, biggest first, including other names', async () => {
    expect((await searchCities('oldenburg'))[0]).toMatchObject({ name: 'Oldenburg', country: 'DE', region: 'Lower Saxony' });
    expect((await searchCities('München'))[0]).toMatchObject({ name: 'Munich', country: 'DE' });
    expect((await searchCities('wien'))[0]).toMatchObject({ name: 'Vienna', country: 'AT' });
    expect(await searchCities('x')).toEqual([]);
  });
});

describe('airport cities', () => {
  it('names the city an airport serves, not the suburb it is in', () => {
    expect(bundledAirport('KRK')!.city).toBe('Kraków');
    expect(bundledAirport('BRU')!.city).toBe('Brussels');
    expect(bundledAirport('CDG')!.city).toBe('Paris');
    expect(bundledAirport('HEL')!.city).toBe('Helsinki');
    expect(bundledAirport('PLQ')!.city).toBe('Palanga');
  });

  it('finds airports by that city, ignoring accents', () => {
    expect(searchAirports('krakow')[0].code).toBe('KRK');
  });
});
