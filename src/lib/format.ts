const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const fmtInt = (n: number) => integer.format(n);
export const fmtKm = (n: number | null | undefined) => (n == null ? '–' : `${integer.format(n)} km`);
export const fmtCompactKm = (n: number) => (n >= 10000 ? `${compact.format(n)} km` : fmtKm(n));
export const fmtPct = (n: number) => `${oneDecimal.format(n)}%`;
export const fmtTimes = (n: number) => `${oneDecimal.format(n)}×`;

export const plural = (n: number, one: string, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;
