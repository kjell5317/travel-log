import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_YEAR, MIN_YEAR, dateValue, formatTripDate, parseTripDate, toDateString } from '../lib/dates';
import { fmtKm, plural } from '../lib/format';
import { distanceKm } from '../lib/geo';
import { formatHeading, legsToText, parseHeading, parseLegs, parseLog, type Issue } from '../lib/parse';
import { CONTINENTS, countryByCode, searchAirports, searchCities, searchCountries, type AirportLookup, type CityResult } from '../lib/reference';
import { computeStats, orderTrips, splitLeg, type TravelStats } from '../lib/stats';
import { DEMO, newTripId } from '../lib/store';
import type { Country, CountryCode, ExtraCity, IATA, Stop, TravelData, Trip } from '../types';

interface Props {
  data: TravelData;
  /** Statistics of the done trips. */
  stats: TravelStats;
  lookup: AirportLookup;
  active: boolean;
  /** Open this trip for editing and scroll to it (from "Edit trip" on the map). */
  editRequest: { tripId: string; nonce: number } | null;
  onSave: (data: TravelData) => Promise<void>;
  /** Replace everything with the example travel log. */
  onLoadExample: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}

interface DraftTrip {
  id: string;
  name: string;
  text: string;
  noFlight: boolean;
  planned: boolean;
  /** Raw date inputs; both optional, a quarter needs a year. */
  year: string;
  quarter: string;
  /** Show the text editor; saved trips are shown read-only until "Edit" is clicked. */
  editing: boolean;
}

function splitDate(date: string | undefined): Pick<DraftTrip, 'year' | 'quarter'> {
  const d = parseTripDate(date);
  return { year: d ? String(d.year) : '', quarter: d?.quarter ? String(d.quarter) : '' };
}

/** The draft's date as stored ("2019-Q3"), or an error message. */
function draftDate(d: Pick<DraftTrip, 'year' | 'quarter'>): { date?: string; error?: string } {
  const year = d.year.trim();
  if (!year) return d.quarter ? { error: 'Add the year for the quarter' } : {};
  const parsed = parseTripDate(d.quarter ? `${year}-Q${d.quarter}` : year);
  return parsed ? { date: toDateString(parsed) } : { error: `The year must be between ${MIN_YEAR} and ${MAX_YEAR}` };
}

const toDrafts = (trips: Trip[]): DraftTrip[] =>
  trips.map((t) => ({
    id: t.id,
    name: t.name,
    text: legsToText(t.legs),
    noFlight: Boolean(t.noFlight),
    planned: Boolean(t.planned),
    ...splitDate(t.date),
    editing: false,
  }));
const draftsToLog = (drafts: DraftTrip[]) =>
  drafts.map((d) => `${formatHeading({ ...d, date: draftDate(d).date })}\n${d.text.trim()}`).join('\n\n') + '\n';
const tripsKey = (trips: { name: string; legs: Stop[][]; noFlight?: boolean; planned?: boolean; date?: string }[]) =>
  JSON.stringify(trips.map((t) => [t.name.trim(), t.legs, Boolean(t.noFlight), Boolean(t.planned), t.date ?? '']));

/** Splits the full-log text into trips, keeping lines as typed (including invalid ones). */
function logToDrafts(text: string, previous: DraftTrip[]): DraftTrip[] {
  const drafts: DraftTrip[] = [];
  for (const line of text.split('\n')) {
    const heading = line.match(/^\s*#\s*(.*)$/);
    if (heading || drafts.length === 0) {
      const { name, noFlight, planned, date } = heading ? parseHeading(heading[1]) : { name: '', noFlight: false, planned: false, date: undefined };
      drafts.push({ id: previous[drafts.length]?.id ?? newTripId(), name, text: '', noFlight, planned, ...splitDate(date), editing: false });
      if (heading) continue;
    }
    const current = drafts[drafts.length - 1];
    current.text = current.text ? `${current.text}\n${line}` : line;
  }
  return orderTrips(drafts.map((d) => ({ ...d, text: d.text.trim() })).filter((d) => d.name || d.text));
}

export function EditView({ data, stats, lookup, active, editRequest, onSave, onLoadExample, onDirtyChange }: Props) {
  // Drafts always list done trips first, then planned ones.
  const [drafts, setDrafts] = useState<DraftTrip[]>(() => toDrafts(data.trips));
  const [mode, setMode] = useState<'cards' | 'text'>('cards');
  const [logText, setLogText] = useState('');
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const isKnown = useCallback((code: IATA) => Boolean(lookup(code)), [lookup]);

  const parsed = useMemo(() => {
    if (mode === 'text') {
      const { trips, issues } = parseLog(logText, isKnown);
      return { trips: trips.map((t, i) => ({ id: drafts[i]?.id ?? '', ...t })), issues, perTrip: [] as Issue[][] };
    }
    const perTrip = drafts.map((d) => {
      const { legs, issues } = parseLegs(d.text, isKnown);
      const { date, error } = draftDate(d);
      if (error) issues.unshift({ line: 0, severity: 'error', message: error });
      return { legs, issues, date };
    });
    // Trips are in order, so warn when a date is earlier than one before it.
    let latest: { value: number; name: string } | null = null;
    perTrip.forEach((p, i) => {
      const date = parseTripDate(p.date);
      if (!date) return;
      if (latest && dateValue(date) < latest.value) {
        p.issues.unshift({ line: 0, severity: 'warning', message: `${formatTripDate(date)} is earlier than “${latest.name}” above — move the trip or check the date` });
      }
      if (!latest || dateValue(date) >= latest.value) latest = { value: dateValue(date), name: drafts[i].name || `trip ${i + 1}` };
    });
    return {
      trips: drafts.map((d, i) => ({ id: d.id, name: d.name.trim(), legs: perTrip[i].legs, noFlight: d.noFlight, planned: d.planned, date: perTrip[i].date })),
      issues: perTrip.flatMap((p) => p.issues),
      perTrip: perTrip.map((p) => p.issues),
    };
  }, [mode, logText, drafts, isKnown]);

  const errors = parsed.issues.filter((i) => i.severity === 'error');
  const dirty = tripsKey(orderTrips(parsed.trips)) !== tripsKey(data.trips) || errors.length > 0;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async () => {
    if (errors.length) {
      setStatus({ kind: 'error', text: `Fix ${plural(errors.length, 'error')} before saving.` });
      return;
    }
    setSaving(true);
    try {
      const trips: Trip[] = orderTrips(parsed.trips).map((t) => ({
        id: t.id || newTripId(),
        name: t.name,
        ...(t.date ? { date: t.date } : {}),
        legs: t.legs,
        ...(t.noFlight ? { noFlight: true } : {}),
        ...(t.planned ? { planned: true } : {}),
      }));
      // Countries your done trips now reach no longer need to be listed as "visited without a trip".
      const reached = computeStats({ trips, extraCountries: [] }, lookup).countries;
      const covered = new Set(reached.map((c) => c.code));
      if (data.settings.homeCountry) covered.add(data.settings.homeCountry);
      const extraCountries = data.extraCountries.filter((c) => !covered.has(c));
      await onSave({ ...data, trips, extraCountries });
      setDrafts(toDrafts(trips));
      if (mode === 'text') setLogText(draftsToLog(toDrafts(trips)));
      const planned = trips.filter((t) => t.planned).length;
      setStatus({
        kind: 'ok',
        text: `Saved ${plural(trips.length - planned, 'trip')}${planned ? ` and ${planned} planned` : ''} ${DEMO ? 'in this browser' : 'to data/travel.json'}`,
      });
    } catch (err) {
      setStatus({ kind: 'error', text: String(err) });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDrafts(toDrafts(data.trips));
    setLogText(draftsToLog(toDrafts(data.trips)));
    setStatus(null);
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty && !saving) save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Open the requested trip in the card editor; scroll once the view is visible.
  const pendingScroll = useRef<string | null>(null);
  useEffect(() => {
    if (!editRequest) return;
    const fromText = mode === 'text' ? logToDrafts(logText, drafts) : drafts;
    setDrafts(fromText.map((d) => (d.id === editRequest.tripId ? { ...d, editing: true } : d)));
    setMode('cards');
    pendingScroll.current = editRequest.tripId;
    // Only a new request should open a trip.
  }, [editRequest]);
  useEffect(() => {
    if (!active || !pendingScroll.current) return;
    const id = pendingScroll.current;
    pendingScroll.current = null;
    requestAnimationFrame(() => document.getElementById(`trip-card-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  });

  const switchMode = (next: 'cards' | 'text') => {
    if (next === mode) return;
    if (next === 'text') setLogText(draftsToLog(drafts));
    else setDrafts(logToDrafts(logText, drafts));
    setMode(next);
  };

  const doneCount = drafts.filter((d) => !d.planned).length;
  const updateDraft = (index: number, patch: Partial<DraftTrip>) => setDrafts((ds) => ds.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const insertDraft = (index: number, planned: boolean) =>
    setDrafts((ds) => [
      ...ds.slice(0, index),
      { id: newTripId(), name: '', text: '', noFlight: false, planned, year: '', quarter: '', editing: true },
      ...ds.slice(index),
    ]);
  const moveDraft = (index: number, delta: number) =>
    setDrafts((ds) => {
      const next = [...ds];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });
  /** Planned trips start right after the done ones, so moving between the lists is a flag flip at the boundary. */
  const setPlanned = (index: number, planned: boolean) =>
    setDrafts((ds) => {
      const next = [...ds];
      const [item] = next.splice(index, 1);
      const boundary = next.filter((d) => !d.planned).length;
      next.splice(boundary, 0, { ...item, planned });
      return next;
    });
  const removeDraft = (index: number) => {
    const d = drafts[index];
    if ((d.text.trim() || d.name.trim()) && !window.confirm(`Delete trip “${d.name || index + 1}”?`)) return;
    setDrafts((ds) => ds.filter((_, i) => i !== index));
  };

  // Trips saved from elsewhere (e.g. "Load example" on the map): show them, unless something is being edited here.
  const savedKey = tripsKey(data.trips);
  const lastSaved = useRef(savedKey);
  useEffect(() => {
    if (lastSaved.current === savedKey) return;
    const untouched = tripsKey(orderTrips(parsed.trips)) === lastSaved.current;
    lastSaved.current = savedKey;
    if (untouched) {
      setDrafts(toDrafts(data.trips));
      setLogText(draftsToLog(toDrafts(data.trips)));
    }
  }, [savedKey]);

  const loadExample = async () => {
    try {
      await onLoadExample();
      setStatus(null);
    } catch (err) {
      setStatus({ kind: 'error', text: String(err) });
    }
  };

  const flightCount = (planned: boolean) =>
    parsed.trips.reduce((n, t) => (t.noFlight || t.planned !== planned ? n : n + t.legs.reduce((m, leg) => m + legFlights(leg), 0)), 0);
  const plannedTrips = parsed.trips.filter((t) => t.planned).length;

  const card = (d: DraftTrip, i: number) => {
    const issues = parsed.perTrip[i] ?? [];
    const legs = parsed.trips[i]?.legs ?? [];
    const hasErrors = issues.some((issue) => issue.severity === 'error');
    const showEditor = d.editing || legs.length === 0 || hasErrors;
    const first = d.planned ? i === doneCount : i === 0;
    const last = d.planned ? i === drafts.length - 1 : i === doneCount - 1;
    const actions = (
      <>
        <button type="button" className="move-section" onClick={() => setPlanned(i, !d.planned)} title={d.planned ? 'Move to your done trips (after the last one)' : 'Move to planned trips'}>
          {d.planned ? '✓ Mark as done' : '→ Move to planned'}
        </button>
        <button type="button" className="icon" onClick={() => moveDraft(i, -1)} disabled={first} aria-label="Move up" title="Move earlier">
          ↑
        </button>
        <button type="button" className="icon" onClick={() => moveDraft(i, 1)} disabled={last} aria-label="Move down" title="Move later">
          ↓
        </button>
        <button type="button" className="icon danger" onClick={() => removeDraft(i)} aria-label="Delete trip" title="Delete trip">
          ✕
        </button>
      </>
    );
    return (
      <li key={d.id} id={`trip-card-${d.id}`} className={`card trip-card${showEditor ? ' trip-card-editing' : ''}${d.planned ? ' trip-card-planned' : ''}`}>
        {showEditor ? (
          <>
            <div className="trip-card-header">
              <span className="trip-number">{i + 1}</span>
              <input
                value={d.name}
                onChange={(e) => updateDraft(i, { name: e.target.value })}
                placeholder={d.planned ? 'Trip name, e.g. Japan next spring' : 'Trip name, e.g. Thailand 2019'}
                aria-label={`Name of trip ${i + 1}`}
                autoFocus={!d.name && !d.text}
              />
              {actions}
            </div>
            <div className="trip-options">
              <label className="date-field">
                When
                <select value={d.quarter} onChange={(e) => updateDraft(i, { quarter: e.target.value })} aria-label="Quarter">
                  <option value="">Quarter</option>
                  {[1, 2, 3, 4].map((q) => (
                    <option key={q} value={q}>
                      Q{q}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_YEAR}
                  max={MAX_YEAR}
                  placeholder="Year"
                  value={d.year}
                  onChange={(e) => updateDraft(i, { year: e.target.value })}
                  aria-label="Year"
                />
                <span className="muted small">optional</span>
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={d.noFlight} onChange={(e) => updateDraft(i, { noFlight: e.target.checked })} />
                No flight — train, bus, car or boat
              </label>
            </div>
            <textarea
              value={d.text}
              onChange={(e) => updateDraft(i, { text: e.target.value })}
              placeholder={
                d.noFlight
                  ? 'One leg per line. Airport codes mark cities; 2-letter country codes put the place in the middle of a country, e.g.\nHAM-CPH-OSL\nMUC-LI-ZRH'
                  : 'One leg per line, airports you passed without leaving, e.g.\nFRA-DXB-BKK\nBKK-DXB-FRA\nParentheses mark travel without flying: (RVN-ALF)-OSL. A 2-letter country code (alone or as BCN-AD) counts a country without a flight.'
              }
              spellCheck={false}
              rows={Math.max(2, d.text.split('\n').length + 1)}
              aria-label={`Legs of trip ${i + 1}`}
              autoFocus={Boolean(d.name || d.text)}
            />
            <LegPreview legs={legs} lookup={lookup} noFlight={d.noFlight} />
            <IssueList issues={issues} />
            <div className="trip-card-footer">
              <button type="button" onClick={() => updateDraft(i, { editing: false })} disabled={legs.length === 0 || hasErrors}>
                Done
              </button>
              <button type="button" className="link small" onClick={() => insertDraft(i + 1, d.planned)}>
                + Insert trip below
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="trip-card-header">
              <span className="trip-number">{i + 1}</span>
              <h3 className="trip-name">
                {d.name || 'Untitled trip'}
                {!d.noFlight && (
                  <span className="flight-mark" title="Flights" aria-label="flights">
                    ✈️
                  </span>
                )}
                {draftDate(d).date && <span className="trip-date">{formatTripDate(parseTripDate(draftDate(d).date)!)}</span>}
              </h3>
              <button type="button" onClick={() => updateDraft(i, { editing: true })}>
                Edit
              </button>
              {actions}
            </div>
            <LegPreview legs={legs} lookup={lookup} noFlight={d.noFlight} />
            <IssueList issues={issues} />
          </>
        )}
      </li>
    );
  };

  return (
    <div className="edit">
      <div className="edit-main">
        <div className="toolbar">
          <div className="segmented" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'cards'} className={mode === 'cards' ? 'active' : ''} onClick={() => switchMode('cards')}>
              Trips
            </button>
            <button type="button" role="tab" aria-selected={mode === 'text'} className={mode === 'text' ? 'active' : ''} onClick={() => switchMode('text')}>
              Text
            </button>
          </div>
          {mode === 'cards' && (
            <button type="button" onClick={() => insertDraft(doneCount, false)}>
              + New trip
            </button>
          )}
          {data.trips.length === 0 && (
            <button type="button" onClick={loadExample}>
              Load example
            </button>
          )}
          <span className="toolbar-spacer" />
          <span className="muted small">
            {plural(parsed.trips.length - plannedTrips, 'trip')} · {plural(flightCount(false), 'flight')}
            {plannedTrips > 0 && ` · ${plannedTrips} planned`}
          </span>
          <button type="button" onClick={discard} disabled={!dirty || saving}>
            Discard
          </button>
          <button type="button" className="primary" onClick={save} disabled={!dirty || saving || errors.length > 0} title="Save (⌘S)">
            {saving ? 'Saving…' : 'Save'}
          </button>
          {status && <div className={`status status-${status.kind}`}>{status.text}</div>}
        </div>

        {mode === 'text' ? (
          <div className="card text-editor">
            <textarea
              value={logText}
              onChange={(e) => setLogText(e.target.value)}
              spellCheck={false}
              rows={Math.max(16, logText.split('\n').length + 2)}
              aria-label="All trips as text"
            />
            <p className="muted small">
              One leg per line. Start each trip with <code># Name</code>, optionally followed by a date like <code>(Q3 2019)</code> or <code>(2019)</code>,{' '}
              <code>(no flight)</code> for trips by train, bus, car or boat, and{' '}
              <code>(planned)</code> for trips that haven’t happened yet. Any trip may use 2-letter country codes such as <code>LI</code> for places
              without an airport; in flight trips, connections to them aren’t flights and aren’t drawn.
            </p>
            <IssueList issues={parsed.issues} />
          </div>
        ) : (
          <>
            <ol className="trip-cards">
              {drafts.map((d, i) => (d.planned ? null : card(d, i)))}
              {doneCount === 0 && (
                <li className="card empty-card">
                  No trips yet. Click <strong>+ New trip</strong> and enter one leg per line (e.g. <code>FRA-DXB-BKK</code>), or load the example.
                </li>
              )}
            </ol>

            <section className="planned-section">
              <div className="planned-header">
                <h2>
                  <i className="swatch swatch-planned" /> Planned trips
                </h2>
                <span className="muted small">Not done yet. Turn on “Future” on the map or statistics page to see what they would add.</span>
                <span className="toolbar-spacer" />
                <button type="button" onClick={() => insertDraft(drafts.length, true)}>
                  + New planned trip
                </button>
              </div>
              <ol className="trip-cards">
                {drafts.map((d, i) => (d.planned ? card(d, i) : null))}
                {drafts.length === doneCount && (
                  <li className="card empty-card">Plan a trip here, or move one of your trips with “→ Move to planned” to simulate your statistics.</li>
                )}
              </ol>
            </section>
          </>
        )}
      </div>

      <aside className="edit-side">
        <AirportFinder />
        <HomeCountry data={data} onSave={onSave} />
        <ExtraPlaces data={data} stats={stats} onSave={onSave} />
      </aside>
    </div>
  );
}

const legFlights = (leg: Stop[]) => splitLeg(leg).reduce((n, p) => (p.kind === 'flown' ? n + p.codes.length - 1 : n), 0);

function LegPreview({ legs, lookup, noFlight }: { legs: Stop[][]; lookup: AirportLookup; noFlight: boolean }) {
  if (!legs.length) return null;
  return (
    <ul className="leg-preview">
      {legs.map((leg, i) => {
        // In flight trips only airport-to-airport connections outside parentheses are flights.
        const codes = leg.flat();
        const parts = splitLeg(leg, noFlight);
        const flown = parts.filter((p) => p.kind === 'flown');
        const flights = flown.reduce((n, p) => n + p.codes.length - 1, 0);
        // How each code after the first is reached from the one before it.
        const reached = parts.flatMap((p) => p.codes.slice(1).map(() => p.kind));
        let km: number | null = 0;
        for (const part of flights ? flown : parts) {
          for (let j = 0; j < part.codes.length - 1; j++) {
            const a = lookup(part.codes[j]);
            const b = lookup(part.codes[j + 1]);
            km = a && b && km != null ? km + distanceKm(a, b) : null;
          }
        }
        const label =
          codes.length === 1
            ? 'visited, no route'
            : noFlight
              ? fmtKm(km)
              : !flights
                ? `no flight · ${fmtKm(km)}`
                : `✈️ ${plural(flights, 'flight')} · ${fmtKm(km)}${flown.length < parts.length ? ' · plus travel without flying' : ''}`;
        return (
          <li key={i}>
            {codes.map((code, j) => {
              const a = lookup(code);
              const withoutFlying = !noFlight && j > 0 && reached[j - 1] !== 'flown';
              return (
                <span key={j}>
                  {j > 0 && (
                    <span className={withoutFlying ? 'arrow arrow-surface' : 'arrow'} title={withoutFlying ? 'Without flying' : undefined}>
                      {withoutFlying ? ' ⇢ ' : ' → '}
                    </span>
                  )}
                  <span
                    className={a ? undefined : 'unknown'}
                    title={a ? (a.type === 'K' ? `${a.name} (marked in the middle of the country)` : `${a.name}, ${countryByCode.get(a.country)?.name ?? a.country}`) : 'Unknown code'}
                  >
                    {a ? `${countryByCode.get(a.country)?.flag ?? ''} ${a.city || a.name}` : `${code}?`}
                  </span>
                </span>
              );
            })}
            <span className="muted"> · {label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="issues">
      {issues.map((issue, i) => (
        <li key={i} className={`issue-${issue.severity}`}>
          <span aria-hidden>{issue.severity === 'error' ? '⛔' : '⚠️'}</span> {issue.line ? `Line ${issue.line}: ` : ''}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

function AirportFinder() {
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const results = useMemo(() => searchAirports(query, 8), [query]);
  const countryResults = useMemo(() => searchCountries(query, new Set(), 3), [query]);
  const copy = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopied(code);
  };
  return (
    <section className="card">
      <h2>Find a code</h2>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="City, airport, country or code" aria-label="Search airports and countries" />
      <ul className="airport-results">
        {results.map((a) => (
          <li key={a.code}>
            <button type="button" onClick={() => copy(a.code)} title="Copy code">
              <strong>{a.code}</strong>
              <span>
                {a.city || a.name} <span className="muted">· {a.name}</span>
              </span>
              <span>{countryByCode.get(a.country)?.flag}</span>
            </button>
          </li>
        ))}
        {countryResults.map((c) => (
          <li key={c.code}>
            <button type="button" onClick={() => copy(c.code)} title="Copy code — for no-flight trips, marks the middle of the country">
              <strong>{c.code}</strong>
              <span>
                {c.name} <span className="muted">· country, no-flight trips</span>
              </span>
              <span>{c.flag}</span>
            </button>
          </li>
        ))}
      </ul>
      {copied && <p className="muted small">Copied {copied} to the clipboard.</p>}
    </section>
  );
}

function HomeCountry({ data, onSave }: { data: TravelData; onSave: (data: TravelData) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const home = data.settings.homeCountry ?? '';
  const sorted = useMemo(() => [...countryByCode.values()].sort((a, b) => a.name.localeCompare(b.name)), []);
  return (
    <section className="card">
      <h2>Home country</h2>
      <p className="muted small">Counts as visited from the start, before your first trip, and is shaded a little darker on the map.</p>
      <select
        value={home}
        onChange={(e) => {
          const { homeCountry: _old, ...settings } = data.settings;
          setError(null);
          onSave({ ...data, settings: e.target.value ? { ...settings, homeCountry: e.target.value } : settings }).catch((err) => setError(String(err)));
        }}
        aria-label="Home country"
      >
        <option value="">None</option>
        {sorted.map((c) => (
          <option key={c.code} value={c.code}>
            {c.flag} {c.name}
          </option>
        ))}
      </select>
      {error && <p className="status-error small">{error}</p>}
    </section>
  );
}

type PlaceResult = { kind: 'city'; key: string; city: CityResult } | { kind: 'country'; key: string; country: Country };

// Several towns share a name within a country (two Heidelbergs in South Africa), so the position is part of the key.
const cityKey = (c: { name: string; country: string; lat: number; lon: number }) => `${c.name}|${c.country}|${c.lat}|${c.lon}`;
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 0 });

/** Cities (any city, with or without an airport) and countries you've been to outside your trips. */
function ExtraPlaces({ data, stats, onSave }: { data: TravelData; stats: TravelStats; onSave: (data: TravelData) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cityResults, setCityResults] = useState<CityResult[]>([]);
  // Latest lists including adds whose save hasn't finished, so quick successive adds don't drop each other.
  const latest = useRef({ countries: data.extraCountries, cities: data.extraCities });
  useEffect(() => {
    latest.current = { countries: data.extraCountries, cities: data.extraCities };
  }, [data.extraCountries, data.extraCities]);

  // Countries your done trips reach (with or without flying) don't belong on this list.
  const reached = useMemo(
    () => new Set(stats.countries.filter((c) => c.kind === 'flight' || c.kind === 'surface' || c.home).map((c) => c.code)),
    [stats],
  );
  const transit = useMemo(() => new Set(stats.transitOnly.map((c) => c.code)), [stats]);
  const listedCountries = data.extraCountries.filter((c) => !reached.has(c));
  const addedCities = useMemo(() => new Set(data.extraCities.map(cityKey)), [data.extraCities]);

  useEffect(() => {
    let current = true;
    searchCities(query, 6).then((found) => current && setCityResults(found.filter((c) => !addedCities.has(cityKey(c)))));
    return () => {
      current = false;
    };
  }, [query, addedCities]);
  const excludeCountries = useMemo(() => new Set([...reached, ...data.extraCountries]), [reached, data.extraCountries]);
  const countryResults = useMemo(() => searchCountries(query, excludeCountries, 3), [query, excludeCountries]);
  const results: PlaceResult[] = query.trim()
    ? [
        ...cityResults.map((city): PlaceResult => ({ kind: 'city', key: `city-${cityKey(city)}`, city })),
        ...countryResults.map((country): PlaceResult => ({ kind: 'country', key: `country-${country.code}`, country })),
      ]
    : [];
  const reachedMatches =
    results.length === 0 ? searchCountries(query, new Set(data.extraCountries), 3).filter((c) => reached.has(c.code)) : [];

  const save = (next: { countries?: CountryCode[]; cities?: ExtraCity[] }) => {
    latest.current = {
      countries: next.countries ? [...new Set(next.countries)].filter((c) => !reached.has(c)).sort() : latest.current.countries,
      cities: next.cities ?? latest.current.cities,
    };
    setError(null);
    onSave({ ...data, extraCountries: latest.current.countries, extraCities: latest.current.cities }).catch((err) => setError(String(err)));
  };
  const add = (result: PlaceResult) => {
    if (result.kind === 'city') {
      const { name, country, lat, lon } = result.city;
      save({ cities: [...latest.current.cities, { name, country, lat, lon }] });
    } else {
      save({ countries: [...latest.current.countries, result.country.code] });
    }
    setQuery('');
    setActive(0);
  };

  return (
    <section className="card">
      <h2>Cities without a trip</h2>
      <p className="muted small">Cities and countries you’ve been to that none of your trips reach; a city counts its country too. Saved immediately.</p>
      {data.extraCities.length > 0 && (
        <div className="chips">
          {data.extraCities.map((city) => (
            <span key={cityKey(city)} className="chip">
              {countryByCode.get(city.country)?.flag} {city.name}
              <button
                type="button"
                onClick={() => save({ cities: latest.current.cities.filter((c) => cityKey(c) !== cityKey(city)) })}
                aria-label={`Remove ${city.name}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {listedCountries.length > 0 && (
        <div className="chips">
          {listedCountries.map((code) => (
            <span key={code} className="chip">
              {countryByCode.get(code)?.flag} {countryByCode.get(code)?.name ?? code}
              <span className="muted">country</span>
              <button type="button" onClick={() => save({ countries: latest.current.countries.filter((c) => c !== code) })} aria-label={`Remove ${code}`}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="search"
        role="combobox"
        aria-label="Add a city or country"
        aria-autocomplete="list"
        aria-expanded={results.length > 0}
        aria-controls="place-results"
        aria-activedescendant={results[active] ? `place-option-${results[active].key}` : undefined}
        placeholder="Add a city or country, e.g. Heidelberg"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(results.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            add(results[active]);
          } else if (e.key === 'Escape') {
            setQuery('');
          }
        }}
      />
      {results.length > 0 && (
        <ul id="place-results" role="listbox" className="search-results">
          {results.map((r, i) => (
            <li
              key={r.key}
              id={`place-option-${r.key}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => add(r)}
            >
              {r.kind === 'city' ? (
                <>
                  <span>{countryByCode.get(r.city.country)?.flag}</span>
                  <span>
                    {r.city.name}
                    {r.city.region && <span className="muted"> · {r.city.region}</span>}
                  </span>
                  <span className="muted">{compactNumber.format(r.city.population)}</span>
                </>
              ) : (
                <>
                  <span>{r.country.flag}</span>
                  <span>
                    {r.country.name}
                    <span className="muted"> · country{transit.has(r.country.code) ? ', transit only so far' : ''}</span>
                  </span>
                  <span className="muted">{CONTINENTS[r.country.continent]}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {reachedMatches.length > 0 && (
        <p className="muted small">{reachedMatches.map((c) => c.name).join(', ')}: already counted.</p>
      )}
      {query.trim().length > 1 && results.length === 0 && reachedMatches.length === 0 && (
        <p className="muted small">Nothing matches “{query.trim()}”.</p>
      )}
      {error && <p className="status-error small">{error}</p>}
    </section>
  );
}
