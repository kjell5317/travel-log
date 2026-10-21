import { useCallback, useEffect, useState } from 'react';
import exampleJson from '../../data/travel.example.json';
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
        legs: (t.legs ?? []).map((leg) => leg.map((stop) => (Array.isArray(stop) ? stop.map((code) => code.toUpperCase()) : stop.toUpperCase()))),
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

/** The example travel log (data/travel.example.json), shown by "Load example" and in the demo. */
export function exampleData(): TravelData {
  return normalizeData(exampleJson as Partial<TravelData>);
}

/**
 * Demo build (`npm run build:demo`, e.g. on GitHub Pages): there is no server to save to, so the app starts
 * with the example and keeps changes in this browser only.
 */
export const DEMO = import.meta.env.VITE_DEMO === 'true';
const DEMO_KEY = 'travel.demo';

function readDemoData(): TravelData {
  try {
    const stored = localStorage.getItem(DEMO_KEY);
    if (stored) return normalizeData(JSON.parse(stored));
  } catch {
    // Unreadable or unavailable storage: start from the example.
  }
  return exampleData();
}

export function newTripId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function useTravelData() {
  const [data, setData] = useState<TravelData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (DEMO) {
      setData(readDemoData());
      return;
    }
    fetch('/api/data')
      .then((res) => {
        if (!res.ok) throw new Error(`Loading data failed (${res.status})`);
        return res.json();
      })
      .then((raw) => setData(normalizeData(raw)))
      .catch((err) => setError(String(err)));
  }, []);

  const save = useCallback(async (next: TravelData) => {
    if (DEMO) {
      try {
        localStorage.setItem(DEMO_KEY, JSON.stringify(next));
      } catch {
        // Not kept after a reload when storage is unavailable, but works for this visit.
      }
      setData(next);
      return;
    }
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
