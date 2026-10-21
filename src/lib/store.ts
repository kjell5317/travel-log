import { useCallback, useEffect, useState } from 'react';
import type { CountryBasis, TravelData } from '../types';
import { parseTripDate, toDateString } from './dates';
import { countryByCode } from './reference';
import { orderTrips } from './stats';

export const EMPTY_DATA: TravelData = {
  version: 1,
  trips: [],
  extraCountries: [],
  extraCities: [],
  customAirports: {},
  settings: { countryBasis: 'un+observers' },
};

const BASES: CountryBasis[] = ['un+observers', 'un+observers+visited'];

/** Fills in defaults and drops invalid entries, so older or hand-edited files load safely. */
export function normalizeData(raw: Partial<TravelData> | null): TravelData {
  return {
    ...EMPTY_DATA,
    ...raw,
    trips: orderTrips(
      (raw?.trips ?? []).map((t, i) => ({
        id: t.id || `trip-${i}-${Math.random().toString(36).slice(2, 8)}`,
        name: t.name ?? '',
        ...(parseTripDate(t.date) ? { date: toDateString(parseTripDate(t.date)!) } : {}),
        legs: (t.legs ?? []).map((leg) => leg.map((code) => code.toUpperCase())),
        ...(t.noFlight ? { noFlight: true } : {}),
        ...(t.planned ? { planned: true } : {}),
      })),
    ),
    extraCountries: raw?.extraCountries ?? [],
    extraCities: (raw?.extraCities ?? []).filter(
      (c) => c && typeof c.name === 'string' && countryByCode.has(c.country) && Number.isFinite(c.lat) && Number.isFinite(c.lon),
    ),
    customAirports: raw?.customAirports ?? {},
    settings: {
      countryBasis: BASES.includes(raw?.settings?.countryBasis as CountryBasis) ? raw!.settings!.countryBasis : EMPTY_DATA.settings.countryBasis,
      ...(countryByCode.has(raw?.settings?.homeCountry ?? '') ? { homeCountry: raw!.settings!.homeCountry } : {}),
    },
  };
}

export function newTripId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function useTravelData() {
  const [data, setData] = useState<TravelData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/data')
      .then((res) => {
        if (!res.ok) throw new Error(`Loading data failed (${res.status})`);
        return res.json();
      })
      .then((raw) => setData(normalizeData(raw)))
      .catch((err) => setError(String(err)));
  }, []);

  const save = useCallback(async (next: TravelData) => {
    const res = await fetch('/api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Saving failed (${res.status})`);
    setData(next);
  }, []);

  return { data, error, save };
}
