import airportsJson from '../data/airports.json';
import countriesJson from '../data/countries.json';
import type { Airport, AirportType, Country, CountryCode, CustomAirport, IATA } from '../types';

/** `servedCity`: the city an airport serves when its listed town is a suburb ("Kraków" for Balice). */
type AirportRow = [name: string, city: string, country: string, lat: number, lon: number, type: string, servedCity?: string];
const airportRows = airportsJson as unknown as Record<IATA, AirportRow>;
const airportCodes = Object.keys(airportRows);

const airportCache = new Map<IATA, Airport>();

export function bundledAirport(code: IATA): Airport | undefined {
  let airport = airportCache.get(code);
  if (airport) return airport;
  const row = airportRows[code];
  if (!row) return undefined;
  const [name, town, country, lat, lon, type, servedCity] = row;
  airport = { code, name, city: servedCity ?? cleanTown(town), country, lat, lon, type: type as AirportType };
  airportCache.set(code, airport);
  return airport;
}

/** "Paris (Roissy-en-France, Val-d'Oise)" → "Paris", "London, Essex" → "London". */
function cleanTown(town: string): string {
  return town.replace(/\s*\(.*\)\s*$/, '').split(',')[0].trim();
}

export type AirportLookup = (code: IATA) => Airport | undefined;

/** Two-letter codes stand for a whole country (in no-flight trips), placed at its centre. */
export const isCountryCode = (code: string) => /^[A-Z]{2}$/.test(code);

const countryPlaceCache = new Map<string, Airport>();

function countryPlace(code: CountryCode): Airport | undefined {
  let place = countryPlaceCache.get(code);
  if (place) return place;
  const country = countryByCode.get(code);
  if (!country || country.lat == null || country.lon == null) return undefined;
  place = { code, name: country.name, city: '', country: code, lat: country.lat, lon: country.lon, type: 'K' };
  countryPlaceCache.set(code, place);
  return place;
}

export function createAirportLookup(custom: Record<IATA, CustomAirport> = {}): AirportLookup {
  const customAirports = new Map<IATA, Airport>(
    Object.entries(custom).map(([code, a]) => [code.toUpperCase(), { ...a, code: code.toUpperCase(), type: 'X' }]),
  );
  return (code) => (isCountryCode(code) ? countryPlace(code) : (customAirports.get(code) ?? bundledAirport(code)));
}

const TYPE_RANK: Record<string, number> = { L: 0, M: 1, X: 1, R: 2, S: 2, C: 3, W: 4, H: 5 };

/** Finds airports by code, city or name; exact code matches first, then bigger airports. */
export function searchAirports(query: string, limit = 8): Airport[] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const scored: { airport: Airport; score: number }[] = [];
  for (const code of airportCodes) {
    const [name, town, , , , , servedCity] = airportRows[code];
    const lcCity = fold(`${servedCity ?? ''} ${town}`.trim());
    const lcName = fold(name);
    let score: number;
    if (code.toLowerCase() === q) score = 0;
    else if (lcCity.startsWith(q)) score = 10;
    else if (lcName.startsWith(q)) score = 20;
    else if (lcCity.includes(q) || lcName.includes(q)) score = 30;
    else continue;
    const airport = bundledAirport(code)!;
    scored.push({ airport, score: score + (TYPE_RANK[airport.type] ?? 5) });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.airport.code.localeCompare(b.airport.code))
    .slice(0, limit)
    .map((s) => s.airport);
}

export const countries = countriesJson as Country[];
export const countryByCode = new Map<CountryCode, Country>(countries.map((c) => [c.code, c]));
export const countryByCcn3 = new Map<string, Country>(
  countries.filter((c) => c.ccn3).map((c) => [c.ccn3!, c]),
);

/** Lowercase without accents, so "cote" finds "Côte d'Ivoire". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const countrySearchIndex = countries.map((country) => ({
  country,
  name: fold(country.name),
  words: fold(country.name).split(/[\s\-'(),.]+/),
  alt: country.alt.map(fold),
}));

/** Finds countries by name, alternative name ("USA", "Holland") or ISO code; name prefixes rank first. */
export function searchCountries(query: string, exclude: Set<CountryCode> = new Set(), limit = 8): Country[] {
  const q = fold(query.trim());
  if (!q) return [];
  const scored: { country: Country; score: number }[] = [];
  for (const { country, name, words, alt } of countrySearchIndex) {
    if (exclude.has(country.code)) continue;
    let score: number;
    if (name.startsWith(q)) score = 0;
    else if (words.some((w) => w.startsWith(q)) || country.code.toLowerCase() === q) score = 1;
    else if (alt.some((a) => a.startsWith(q))) score = 2;
    else if (name.includes(q) || alt.some((a) => a.includes(q))) score = 3;
    else continue;
    scored.push({ country, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.country.name.localeCompare(b.country.name))
    .slice(0, limit)
    .map((s) => s.country);
}

export interface CityResult {
  name: string;
  country: CountryCode;
  region: string;
  lat: number;
  lon: number;
  population: number;
}

type CityRow = [name: string, country: string, region: number, lat: number, lon: number, population: number, alt?: string];
let cityIndex: Promise<{ city: CityResult; names: string[] }[]> | null = null;

/** The GeoNames city list is large, so it's only loaded when the city search is first used. */
export function loadCities() {
  cityIndex ??= import('../data/cities.json').then(({ default: raw }) => {
    const { regions, cities } = raw as { regions: string[]; cities: CityRow[] };
    return cities.map(([name, country, region, lat, lon, population, alt]) => ({
      city: { name, country, region: regions[region] ?? '', lat, lon, population },
      names: [name, ...(alt ? alt.split('|') : [])].map(fold),
    }));
  });
  return cityIndex;
}

/** Cities by name (also other names like "München"); exact names, then prefixes; bigger cities before smaller. */
export async function searchCities(query: string, limit = 6): Promise<CityResult[]> {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const index = await loadCities();
  const scored: { city: CityResult; score: number }[] = [];
  for (const { city, names } of index) {
    let score: number;
    if (names.includes(q)) score = 0;
    else if (names[0].startsWith(q)) score = 1;
    else if (names.some((n) => n.startsWith(q))) score = 2;
    else if (names[0].includes(q)) score = 3;
    else continue;
    scored.push({ city, score });
    if (scored.length > 400) break;
  }
  // The list is sorted by population, so the order within a score is already biggest first.
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.city);
}

export const CONTINENTS: Record<string, string> = {
  EU: 'Europe',
  AS: 'Asia',
  NA: 'North America',
  SA: 'South America',
  AF: 'Africa',
  OC: 'Oceania',
  AN: 'Antarctica',
};

export function countryName(code: CountryCode): string {
  return countryByCode.get(code)?.name ?? code;
}

export function airportLabel(airport: Airport | undefined, code: IATA): string {
  if (!airport) return code;
  return airport.city || airport.name;
}
