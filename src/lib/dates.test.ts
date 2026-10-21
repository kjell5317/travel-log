import { describe, expect, it } from 'vitest';
import { dateValue, formatTripDate, parseTripDate, readLooseDate, toDateString } from './dates';

describe('trip dates', () => {
  it('parses stored dates', () => {
    expect(parseTripDate('2019-Q3')).toEqual({ year: 2019, quarter: 3 });
    expect(parseTripDate('2019')).toEqual({ year: 2019 });
    expect(parseTripDate('2019-Q5')).toBeNull();
    expect(parseTripDate('19')).toBeNull();
    expect(parseTripDate(undefined)).toBeNull();
  });

  it('reads the loose heading forms', () => {
    for (const s of ['Q3 2019', '2019 Q3', '2019-Q3', 'q3/2019']) expect(readLooseDate(s)).toEqual({ year: 2019, quarter: 3 });
    expect(readLooseDate('2021')).toEqual({ year: 2021 });
    expect(readLooseDate('no flight')).toBeNull();
  });

  it('formats and orders dates', () => {
    expect(formatTripDate({ year: 2019, quarter: 3 })).toBe('Q3 2019');
    expect(toDateString({ year: 2019 })).toBe('2019');
    expect(dateValue({ year: 2019, quarter: 1 })).toBeLessThan(dateValue({ year: 2019, quarter: 2 }));
    expect(dateValue({ year: 2019 })).toBe(2019.5);
  });
});
