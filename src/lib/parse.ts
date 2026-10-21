import type { IATA, Stop } from '../types';
import { formatTripDate, parseTripDate, readLooseDate, toDateString } from './dates';

/**
 * Text format used by the editor. One leg per line, airports separated by
 * dashes, arrows, commas or spaces. In the full-log text mode, "# Name" starts a trip;
 * trailing markers add an optional date ("(Q3 2019)" or "(2019)"), "(no flight)" for a trip
 * made by train, bus, car or boat, and "(planned)" for one that hasn't happened yet.
 * Any trip may also use 2-letter country codes for places without an airport, and a flight trip may put
 * codes in parentheses for the part you travelled without flying:
 *
 *   # Thailand 2019
 *   FRA-DXB-BKK
 *   BKK-DXB-FRA
 *
 *   # Lapland
 *   OSL-RVN
 *   (RVN-ALF)-OSL
 *
 *   # Interrail (Q3 2019) (no flight)
 *   HAM-CPH-OSL
 *   MUC-LI-ZRH
 *
 *   # Japan 2027 (planned)
 *   FRA-HND
 */

export interface Issue {
  /** 1-based line number in the edited text. */
  line: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface ParsedTrip {
  name: string;
  legs: Stop[][];
  noFlight: boolean;
  planned: boolean;
  /** "2019" or "2019-Q3" */
  date?: string;
}

type Heading = Omit<ParsedTrip, 'legs'>;

const MARKER = /\s*\(([^()]*)\)\s*$/;

/** Splits "Name (Q3 2019) (no flight) (planned)" into the name and its markers (in any order). */
export function parseHeading(heading: string): Heading {
  const result: Heading = { name: heading, noFlight: false, planned: false };
  for (let m = result.name.match(MARKER); m; m = result.name.match(MARKER)) {
    const marker = m[1].trim().toLowerCase();
    const date = readLooseDate(marker);
    if (marker === 'planned') result.planned = true;
    else if (marker === 'no flight') result.noFlight = true;
    else if (date) result.date = toDateString(date);
    else break; // ordinary parentheses that belong to the name
    result.name = result.name.slice(0, m.index);
  }
  result.name = result.name.trim();
  return result;
}

export function formatHeading({ name, noFlight, planned, date }: Heading): string {
  const parsed = parseTripDate(date);
  const when = parsed ? ` (${formatTripDate(parsed)})` : '';
  return `# ${name}${when}${noFlight ? ' (no flight)' : ''}${planned ? ' (planned)' : ''}`;
}

const SEPARATORS = /[\s,;/>→–—-]+/;

/**
 * A leg: airports (3-letter IATA codes) in the order you passed them. A 2-letter country code stands
 * for the whole country (marked at its centre); connections to or from it are never flights. A line
 * with just a country code means "I was in this country on this trip". Codes in parentheses were
 * travelled without flying: (RVN-ALF)-OSL is RVN to ALF by train, bus, car or boat, then a flight to OSL.
 */
export function parseLegLine(line: string, lineNo: number, isKnown: (code: IATA) => boolean, issues: Issue[]): Stop[] | null {
  // Parentheses are tokens of their own: "(RVN-ALF)-OSL" → ( RVN ALF ) OSL.
  const tokens = line.replace(/[()]/g, ' $& ').trim().split(SEPARATORS).filter(Boolean);
  if (tokens.length === 0) return null;
  const error = (message: string) => {
    issues.push({ line: lineNo, severity: 'error', message });
    return null;
  };
  const leg: Stop[] = [];
  const codes: IATA[] = [];
  let group: IATA[] | null = null;
  for (const token of tokens) {
    if (token === '(') {
      if (group) return error('Parentheses can’t be nested');
      group = [];
      continue;
    }
    if (token === ')') {
      if (!group) return error('“)” without a matching “(”');
      if (group.length < 2) return error('Parentheses need at least two places you travelled between without flying, e.g. (RVN-ALF)');
      leg.push(group);
      group = null;
      continue;
    }
    const code = token.toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) {
      if (!isKnown(code)) return error(`${code} is not a known 2-letter country code`);
    } else if (!/^[A-Z0-9]{3}$/.test(code)) {
      return error(`"${token}" is neither a 3-letter IATA code nor a 2-letter country code`);
    }
    if (codes.at(-1) === code) return error(`${code} follows itself — a leg needs two different places`);
    codes.push(code);
    if (group) group.push(code);
    else leg.push(code);
  }
  if (group) return error('“(” without a matching “)”');
  if (codes.length < 2 && !/^[A-Z]{2}$/.test(codes[0])) {
    return error('A leg needs at least two airports (origin and destination), or a single country code');
  }
  for (const code of codes) {
    if (!isKnown(code)) {
      issues.push({ line: lineNo, severity: 'warning', message: `Unknown airport ${code} — check the code or add it to customAirports in data/travel.json` });
    }
  }
  return leg;
}

/** Parses the legs of a single trip (one leg per line). */
export function parseLegs(text: string, isKnown: (code: IATA) => boolean): { legs: Stop[][]; issues: Issue[] } {
  const issues: Issue[] = [];
  const legs: Stop[][] = [];
  text.split('\n').forEach((line, i) => {
    const leg = parseLegLine(line, i + 1, isKnown, issues);
    if (leg) legs.push(leg);
  });
  return { legs, issues };
}

/** Parses the full-log text format ("# Trip name" headers followed by legs). */
export function parseLog(text: string, isKnown: (code: IATA) => boolean): { trips: ParsedTrip[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const trips: ParsedTrip[] = [];
  let current: ParsedTrip | null = null;
  text.split('\n').forEach((line, i) => {
    const heading = line.match(/^\s*#\s*(.*)$/);
    if (heading) {
      current = { ...parseHeading(heading[1]), legs: [] };
      trips.push(current);
      return;
    }
    const leg = parseLegLine(line, i + 1, isKnown, issues);
    if (!leg) return;
    if (!current) {
      current = { name: '', legs: [], noFlight: false, planned: false };
      trips.push(current);
    }
    current.legs.push(leg);
  });
  return { trips, issues };
}

export function legsToText(legs: Stop[][]): string {
  return legs.map((leg) => leg.map((stop) => (Array.isArray(stop) ? `(${stop.join('-')})` : stop)).join('-')).join('\n');
}

export function logToText(trips: ParsedTrip[]): string {
  return trips.map((t) => `${formatHeading(t)}\n${legsToText(t.legs)}`).join('\n\n') + '\n';
}
