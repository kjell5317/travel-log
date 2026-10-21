/** Three-letter IATA airport code, e.g. "FRA". */
export type IATA = string;
/** ISO 3166-1 alpha-2 country code, e.g. "DE". */
export type CountryCode = string;

/**
 * A place in a leg: a code, or a group of codes you travelled between without flying.
 * E.g. the leg [["RVN", "ALF"], "OSL"] is RVN to ALF by train, bus, car or boat, then a flight ALF → OSL.
 */
export type Stop = IATA | IATA[];

/**
 * A trip is an ordered list of legs (e.g. outbound + return).
 * A leg is an ordered list of airports you flew through without leaving the airport;
 * every consecutive pair of airports in a leg is one flight, except inside a group (see Stop).
 */
export interface Trip {
  id: string;
  name: string;
  legs: Stop[][];
  /** Travelled by train, bus, car or boat; the IATA codes only mark the places. */
  noFlight?: boolean;
  /** Not done yet; only counted when the "future" view is on. Planned trips come after all done trips. */
  planned?: boolean;
  /** Optional, "2019" or "2019-Q3"; places the trip on the time axis of the countries chart. */
  date?: string;
}

export interface CustomAirport {
  name: string;
  city: string;
  country: CountryCode;
  lat: number;
  lon: number;
}

/** A city you've been to outside your trips (any city, with or without an airport). */
export interface ExtraCity {
  name: string;
  country: CountryCode;
  lat: number;
  lon: number;
}

/**
 * Which set of countries the "% of the world" figure is measured against:
 * the 195 UN members and observers, optionally plus every other place you visited (e.g. Hong Kong, Kosovo).
 */
export type CountryBasis = 'un+observers' | 'un+observers+visited';

export interface TravelData {
  version: 1;
  /** Oldest trip first. */
  trips: Trip[];
  /** Countries visited outside your trips. */
  extraCountries: CountryCode[];
  /** Cities visited outside your trips; their countries count as visited too. */
  extraCities: ExtraCity[];
  /** Airports missing from (or overriding) the bundled airport database. */
  customAirports: Record<IATA, CustomAirport>;
  settings: {
    countryBasis: CountryBasis;
    /** Where you were born / live: counts as visited from the start, before any trip. */
    homeCountry?: CountryCode;
  };
}

/**
 * L large, M medium, S small, H heliport, W seaplane base, C closed/historic, R rail station, X custom,
 * K a whole country (its centre), for trips that name a country instead of an airport,
 * P a city added by hand (no code).
 */
export type AirportType = 'L' | 'M' | 'S' | 'H' | 'W' | 'C' | 'R' | 'X' | 'K' | 'P';

export interface Airport {
  code: IATA;
  name: string;
  city: string;
  country: CountryCode;
  lat: number;
  lon: number;
  type: AirportType;
}

export interface Country {
  code: CountryCode;
  name: string;
  /** AF, AN, AS, EU, NA, OC, SA */
  continent: string;
  /** ISO 3166-1 numeric, used to match the world map shapes. */
  ccn3: string | null;
  un: boolean;
  observer: boolean;
  flag: string;
  /** Alternative names, e.g. "USA", "Holland". */
  alt: string[];
  /** Approximate centre of the country. */
  lat: number | null;
  lon: number | null;
}

export type Selection =
  | { kind: 'flight'; index: number }
  | { kind: 'airport'; code: IATA }
  | { kind: 'country'; code: CountryCode }
  | null;
