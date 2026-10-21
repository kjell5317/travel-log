import { describe, expect, it } from 'vitest';
import { createAirportLookup } from './reference';
import { isDomestic, surfaceLayer, withoutHomeRoutes, type Hop } from './routes';

const lookup = createAirportLookup();
const leg = (...codes: string[]): Hop[] => codes.slice(1).map((code, i) => ({ a: lookup(codes[i]), b: lookup(code), planned: false }));
const names = (list: Hop[]) => list.map((h) => `${h.a?.code}-${h.b?.code}`);

describe('withoutHomeRoutes', () => {
  it('drops a short trip out of the home country and back in two legs', () => {
    expect(withoutHomeRoutes([leg('HAM', 'PRG'), leg('PRG', 'HAM')], 'DE')).toEqual([]);
    // Stops on the way don't matter, only the two legs.
    expect(withoutHomeRoutes([leg('HAM', 'DTM', 'AAH', 'BRU'), leg('BRU', 'CGN')], 'DE')).toEqual([]);
  });

  it('keeps longer trips but drops their routes inside the home country', () => {
    expect(names(withoutHomeRoutes([leg('HAM', 'DTM', 'AAH', 'BRU'), leg('BRU', 'CDG'), leg('CDG', 'STR', 'MUC')], 'DE'))).toEqual([
      'AAH-BRU',
      'BRU-CDG',
      'CDG-STR',
    ]);
    expect(names(withoutHomeRoutes([leg('HAM', 'PRG', 'HAM')], 'DE'))).toEqual(['HAM-PRG', 'PRG-HAM']);
  });

  it('keeps two legs that don’t start and end at home, and drops trips inside it', () => {
    expect(names(withoutHomeRoutes([leg('ZAG', 'SZG'), leg('SZG', 'MUC')], 'DE'))).toEqual(['ZAG-SZG', 'SZG-MUC']);
    expect(withoutHomeRoutes([leg('HAM', 'MUC'), leg('MUC', 'HAM')], 'DE')).toEqual([]);
  });

  it('tells domestic routes by their two ends', () => {
    expect(isDomestic(lookup('HAM'), lookup('MUC'), 'DE')).toBe(true);
    expect(isDomestic(lookup('HAM'), lookup('PRG'), 'DE')).toBe(false);
    expect(isDomestic(undefined, lookup('MUC'), 'DE')).toBe(false);
  });
});

describe('surfaceLayer', () => {
  const trips = [[leg('HAM', 'PRG'), leg('PRG', 'HAM')], [leg('DE', 'AT', 'VRN'), leg('VRN', 'DE')], [leg('HAM', 'DTM', 'AAH'), leg('AAH', 'BRU'), leg('BRU', 'CDG')]];

  it('draws no lines for home routes, but keeps their cities', () => {
    const { segments, stops } = surfaceLayer(trips, 'DE', new Set());
    expect(segments.map((s) => s.key).sort()).toEqual(['AAH-BRU', 'BRU-CDG']);
    expect(stops.map((s) => s.place.code).sort()).toEqual(['AAH', 'BRU', 'CDG', 'DTM', 'HAM', 'PRG', 'VRN']);
  });

  it('skips places already drawn as airports and draws everything without a home country', () => {
    const { segments, stops } = surfaceLayer(trips, undefined, new Set(['HAM', 'PRG']));
    expect(segments).toHaveLength(8);
    expect(stops.map((s) => s.place.code)).not.toContain('HAM');
    expect(stops.map((s) => s.place.code)).toContain('DE');
  });

  it('only hides domestic parts of flight trips (each a trip of one leg)', () => {
    const { segments, stops } = surfaceLayer([[leg('RVN', 'ALF')], [leg('TOS', 'ALF')]], 'NO', new Set(['ALF']));
    expect(segments.map((s) => s.key)).toEqual(['ALF-RVN']);
    expect(stops.map((s) => s.place.code).sort()).toEqual(['RVN', 'TOS']);
  });
});
