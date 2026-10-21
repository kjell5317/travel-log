import { describe, expect, it } from 'vitest';
import { createAirportLookup } from './reference';
import { surfaceLayer, withoutHomeConnections, type Hop } from './routes';

const lookup = createAirportLookup();
const hops = (...codes: string[][]): Hop[] =>
  codes.flatMap((leg) => leg.slice(1).map((code, i) => ({ a: lookup(leg[i]), b: lookup(code), planned: false })));
const names = (list: Hop[]) => list.map((h) => `${h.a?.code}-${h.b?.code}`);

describe('withoutHomeConnections', () => {
  it('drops the first connection out of and the last back into the home country', () => {
    expect(names(withoutHomeConnections(hops(['DE', 'AT', 'VRN'], ['VRN', 'VCE'], ['VCE', 'CH', 'LI'], ['LI', 'DE']), 'DE'))).toEqual([
      'AT-VRN',
      'VRN-VCE',
      'VCE-CH',
      'CH-LI',
    ]);
    expect(names(withoutHomeConnections(hops(['ZAG', 'SZG'], ['SZG', 'MUC']), 'DE'))).toEqual(['ZAG-SZG']);
  });

  it('also drops travel inside the home country before leaving and after coming back', () => {
    expect(names(withoutHomeConnections(hops(['HAM', 'DTM', 'AAH'], ['AAH', 'BRU'], ['BRU', 'CDG']), 'DE'))).toEqual(['BRU-CDG']);
    expect(names(withoutHomeConnections(hops(['ZAG', 'SZG'], ['SZG', 'MUC', 'HAM']), 'DE'))).toEqual(['ZAG-SZG']);
  });

  it('leaves nothing of a simple there-and-back trip', () => {
    expect(names(withoutHomeConnections(hops(['HAM', 'PRG'], ['PRG', 'HAM']), 'DE'))).toEqual([]);
  });

  it('keeps crossings in the middle of a trip and trips that stay inside the home country', () => {
    expect(names(withoutHomeConnections(hops(['SZG', 'DRS'], ['DRS', 'KGD']), 'DE'))).toEqual(['SZG-DRS', 'DRS-KGD']);
    expect(names(withoutHomeConnections(hops(['HAM', 'MUC'], ['MUC', 'HAM']), 'DE'))).toEqual(['HAM-MUC', 'MUC-HAM']);
  });
});

describe('surfaceLayer', () => {
  const trips = [hops(['HAM', 'PRG'], ['PRG', 'HAM']), hops(['DE', 'AT', 'VRN'], ['VRN', 'DE']), hops(['HAM', 'DTM', 'AAH'], ['AAH', 'BRU'], ['BRU', 'CDG'])];

  it('draws no lines for the way out and home, but keeps their cities', () => {
    const { segments, stops } = surfaceLayer(trips, 'DE', new Set());
    expect(segments.map((s) => s.key).sort()).toEqual(['AT-VRN', 'BRU-CDG']);
    expect(stops.map((s) => s.place.code).sort()).toEqual(['AAH', 'AT', 'BRU', 'CDG', 'DTM', 'HAM', 'PRG', 'VRN']);
  });

  it('skips places already drawn as airports and draws everything without a home country', () => {
    const { segments, stops } = surfaceLayer(trips, undefined, new Set(['HAM', 'PRG']));
    expect(segments).toHaveLength(8);
    expect(stops.map((s) => s.place.code)).not.toContain('HAM');
    expect(stops.map((s) => s.place.code)).toContain('DE');
  });
});
