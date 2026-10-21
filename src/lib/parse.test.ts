import { describe, expect, it } from 'vitest';
import { legsToText, logToText, parseLegs, parseLog } from './parse';

const known = (code: string) => code !== 'QQQ';

describe('parseLegs', () => {
  it('accepts different separators and lowercase', () => {
    const { legs, issues } = parseLegs('fra-dxb-bkk\nBKK → DXB > FRA\n\nmuc, hel nrt', known);
    expect(legs).toEqual([
      ['FRA', 'DXB', 'BKK'],
      ['BKK', 'DXB', 'FRA'],
      ['MUC', 'HEL', 'NRT'],
    ]);
    expect(issues).toEqual([]);
  });

  it('rejects single airports, bad tokens and repeated airports', () => {
    const { legs, issues } = parseLegs('FRA\nFRA-FRANK\nFRA-FRA', known);
    expect(legs).toEqual([]);
    expect(issues.map((i) => [i.line, i.severity])).toEqual([
      [1, 'error'],
      [2, 'error'],
      [3, 'error'],
    ]);
  });

  it('warns about unknown airports but keeps the leg', () => {
    const { legs, issues } = parseLegs('FRA-QQQ', known);
    expect(legs).toEqual([['FRA', 'QQQ']]);
    expect(issues).toMatchObject([{ line: 1, severity: 'warning' }]);
  });
});

describe('country codes', () => {
  const knownWithCountries = (code: string) => code !== 'QQQ' && code !== 'QQ';

  it('work in any trip', () => {
    expect(parseLegs('MUC-LI-ZRH', knownWithCountries)).toEqual({ legs: [['MUC', 'LI', 'ZRH']], issues: [] });
    expect(parseLog('# Flight\nFRA-BCN\nBCN-AD', knownWithCountries).issues).toEqual([]);
  });

  it('may stand alone on a line, airports may not', () => {
    expect(parseLegs('AD', knownWithCountries)).toEqual({ legs: [['AD']], issues: [] });
    expect(parseLegs('FRA', knownWithCountries).issues).toMatchObject([{ severity: 'error' }]);
  });

  it('must be known countries', () => {
    const { issues } = parseLegs('MUC-QQ', knownWithCountries);
    expect(issues).toMatchObject([{ severity: 'error' }]);
  });
});

describe('parseLog', () => {
  it('splits trips on # headings and round-trips', () => {
    const text = '# Thailand\nFRA-DXB-BKK\nBKK-DXB-FRA\n\n# NYC\nFRA-JFK\nJFK-FRA\n';
    const { trips, issues } = parseLog(text, known);
    expect(issues).toEqual([]);
    expect(trips).toEqual([
      { name: 'Thailand', legs: [['FRA', 'DXB', 'BKK'], ['BKK', 'DXB', 'FRA']], noFlight: false, planned: false },
      { name: 'NYC', legs: [['FRA', 'JFK'], ['JFK', 'FRA']], noFlight: false, planned: false },
    ]);
    expect(logToText(trips)).toBe(text);
    expect(legsToText(trips[0].legs)).toBe('FRA-DXB-BKK\nBKK-DXB-FRA');
  });

  it('puts legs before the first heading into an untitled trip', () => {
    const { trips } = parseLog('FRA-LHR\n# Later\nLHR-FRA', known);
    expect(trips).toEqual([
      { name: '', legs: [['FRA', 'LHR']], noFlight: false, planned: false },
      { name: 'Later', legs: [['LHR', 'FRA']], noFlight: false, planned: false },
    ]);
  });

  it('reads and writes the (no flight) marker', () => {
    const text = '# Interrail (no flight)\nHAM-CPH-OSL\n';
    const { trips } = parseLog(text, known);
    expect(trips).toEqual([{ name: 'Interrail', legs: [['HAM', 'CPH', 'OSL']], noFlight: true, planned: false }]);
    expect(logToText(trips)).toBe(text);
    expect(parseLog('# Ferry (No Flight)\nKEL-GOT', known).trips[0]).toMatchObject({ name: 'Ferry', noFlight: true });
  });

  it('reads and writes the (planned) marker, alone or with (no flight)', () => {
    const text = '# Japan (planned)\nFRA-HND\n\n# Rail tour (no flight) (planned)\nHND-KIX\n';
    const { trips } = parseLog(text, known);
    expect(trips.map((t) => [t.name, t.noFlight, t.planned])).toEqual([
      ['Japan', false, true],
      ['Rail tour', true, true],
    ]);
    expect(logToText(trips)).toBe(text);
    expect(parseLog('# Ferry (planned) (no flight)\nKEL-GOT', known).trips[0]).toMatchObject({ name: 'Ferry', noFlight: true, planned: true });
  });

  it('reads and writes dates in headings', () => {
    const text = '# Thailand (Q3 2019)\nFRA-BKK\n\n# Japan (2027) (planned)\nFRA-HND\n';
    const { trips } = parseLog(text, known);
    expect(trips.map((t) => [t.name, t.date, t.planned])).toEqual([
      ['Thailand', '2019-Q3', false],
      ['Japan', '2027', true],
    ]);
    expect(logToText(trips)).toBe(text);
    expect(parseLog('# Rome (2019 Q2) (no flight)\nHAM-FCO', known).trips[0]).toMatchObject({ name: 'Rome', date: '2019-Q2', noFlight: true });
    // Parentheses that aren't markers stay part of the name.
    expect(parseLog('# Rome (with Anna)\nHAM-FCO', known).trips[0]).toMatchObject({ name: 'Rome (with Anna)' });
  });
});
