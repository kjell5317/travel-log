import { describe, expect, it } from 'vitest';
import { formatData } from './dataApi';

describe('formatData', () => {
  it('keeps each leg (with its groups) and the country list on one line', () => {
    const data = { trips: [{ id: 'a', legs: [['OSL', 'RVN'], [['RVN', 'ALF'], 'OSL'], [['TOS', 'ALF']], ['AD']] }], extraCountries: ['AT', 'CH'] };
    const text = formatData(data);
    expect(text).toBe(
      [
        '{',
        '  "trips": [',
        '    {',
        '      "id": "a",',
        '      "legs": [',
        '        ["OSL", "RVN"],',
        '        [["RVN", "ALF"], "OSL"],',
        '        [["TOS", "ALF"]],',
        '        ["AD"]',
        '      ]',
        '    }',
        '  ],',
        '  "extraCountries": ["AT", "CH"]',
        '}',
        '',
      ].join('\n'),
    );
    expect(JSON.parse(text)).toEqual(data);
  });
});
