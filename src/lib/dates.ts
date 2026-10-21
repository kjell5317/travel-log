/** Trip dates are coarse on purpose: a year, optionally with a quarter. Stored as "2019" or "2019-Q3". */
export interface TripDate {
  year: number;
  quarter?: 1 | 2 | 3 | 4;
}

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

export function parseTripDate(value: string | undefined): TripDate | null {
  const m = value?.trim().match(/^(\d{4})(?:-Q([1-4]))?$/i);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  return m[2] ? { year, quarter: Number(m[2]) as TripDate['quarter'] } : { year };
}

export function toDateString(date: TripDate): string {
  return date.quarter ? `${date.year}-Q${date.quarter}` : String(date.year);
}

/** "Q3 2019" or "2019". */
export function formatTripDate(date: TripDate): string {
  return date.quarter ? `Q${date.quarter} ${date.year}` : String(date.year);
}

/** Position on a continuous time axis: the middle of the quarter (or year). */
export function dateValue(date: TripDate): number {
  return date.quarter ? date.year + (date.quarter - 1) / 4 + 1 / 8 : date.year + 0.5;
}

export function todayValue(now = new Date()): number {
  return now.getFullYear() + now.getMonth() / 12 + now.getDate() / 365;
}

/** Reads "Q3 2019", "2019 Q3", "2019-Q3", "Q3/2019" or "2019" (as used in "# Trip (Q3 2019)" headings). */
export function readLooseDate(text: string): TripDate | null {
  const t = text.trim();
  const m = t.match(/^Q([1-4])\s*[\s/-]?\s*(\d{4})$/i) ?? t.match(/^(\d{4})\s*[\s/-]?\s*Q([1-4])$/i);
  if (m) {
    const [quarter, year] = m[1].length === 4 ? [m[2], m[1]] : [m[1], m[2]];
    return parseTripDate(`${year}-Q${quarter}`);
  }
  return /^\d{4}$/.test(t) ? parseTripDate(t) : null;
}
