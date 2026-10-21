import { useCallback, useEffect, useMemo, useState } from 'react';
import { exampleData } from './lib/example';
import { createAirportLookup } from './lib/reference';
import { computeStats } from './lib/stats';
import { useTravelData } from './lib/store';
import type { Selection, TravelData } from './types';
import { EditView } from './views/EditView';
import { ExploreView } from './views/ExploreView';
import { StatsView } from './views/StatsView';

const VIEWS = [
  { id: 'explore', label: 'Map' },
  { id: 'stats', label: 'Statistics' },
  { id: 'edit', label: 'Edit trips' },
] as const;
type View = (typeof VIEWS)[number]['id'];

const SHOW_FUTURE_KEY = 'travel.showFuture';

function readShowFuture(): boolean {
  try {
    return localStorage.getItem(SHOW_FUTURE_KEY) === 'true';
  } catch {
    return false;
  }
}

function readHash(): View {
  const id = window.location.hash.replace(/^#\/?/, '');
  return VIEWS.some((v) => v.id === id) ? (id as View) : 'explore';
}

export function App() {
  const { data, error, save } = useTravelData();
  const [view, setView] = useState<View>(readHash);
  const [selection, setSelection] = useState<Selection>(null);
  const [tripFilter, setTripFilter] = useState<number | null>(null);
  const [editDirty, setEditDirty] = useState(false);
  // "Edit trip" on the map: which trip the editor should open (the nonce repeats a request for the same trip).
  const [editRequest, setEditRequest] = useState<{ tripId: string; nonce: number } | null>(null);
  const [showFuture, setShowFutureState] = useState(readShowFuture);

  const setShowFuture = useCallback((on: boolean) => {
    setShowFutureState(on);
    try {
      localStorage.setItem(SHOW_FUTURE_KEY, String(on));
    } catch {
      // Not remembered when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    const onHash = () => setView(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const lookup = useMemo(() => createAirportLookup(data?.customAirports), [data?.customAirports]);
  // Done trips only, and done + planned trips (the "future" simulation).
  const statsNow = useMemo(() => (data ? computeStats(data, lookup, { homeCountry: data.settings.homeCountry }) : null), [data, lookup]);
  const statsFuture = useMemo(
    () => (data ? computeStats(data, lookup, { includePlanned: true, homeCountry: data.settings.homeCountry }) : null),
    [data, lookup],
  );
  const hasPlanned = Boolean(data?.trips.some((t) => t.planned));
  const stats = showFuture && hasPlanned ? statsFuture : statsNow;

  // Drop selections that no longer exist after the data changed.
  useEffect(() => {
    if (!stats) return;
    if (selection?.kind === 'flight' && selection.index >= stats.flights.length) setSelection(null);
    if (tripFilter != null && tripFilter >= stats.trips.length) setTripFilter(null);
  }, [stats, selection, tripFilter]);

  const navigate = useCallback((next: View, nextSelection?: Selection) => {
    window.location.hash = `/${next}`;
    if (nextSelection !== undefined) {
      setSelection(nextSelection);
      setTripFilter(null);
    }
  }, []);

  const editTrip = useCallback((tripId: string) => {
    setEditRequest({ tripId, nonce: Date.now() });
    window.location.hash = '/edit';
  }, []);

  const loadExample = useCallback(async () => {
    if (!data) return;
    const hasOwn = data.trips.length || data.extraCountries.length || data.extraCities.length || data.settings.homeCountry;
    if (hasOwn && !window.confirm('Replace your trips, countries and settings with the example?')) return;
    await save(exampleData());
  }, [data, save]);

  const updateData = useCallback((patch: Partial<TravelData>) => (data ? save({ ...data, ...patch }) : Promise.resolve()), [data, save]);

  if (error) return <div className="app-message">Could not load your travel data: {error}</div>;
  if (!data || !stats || !statsNow) return <div className="app-message">Loading…</div>;
  const future = { showFuture: showFuture && hasPlanned, hasPlanned, onShowFuture: setShowFuture };

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <span aria-hidden>✈</span> Travel log
        </h1>
        <nav>
          {VIEWS.map((v) => (
            <a key={v.id} href={`#/${v.id}`} className={view === v.id ? 'active' : undefined}>
              {v.label}
              {v.id === 'edit' && editDirty && <span className="dirty-dot" title="Unsaved changes" />}
            </a>
          ))}
        </nav>
      </header>
      <main className={`app-main view-${view}`}>
        {view === 'explore' && (
          <ExploreView
            data={data}
            stats={stats}
            selection={selection}
            onSelect={setSelection}
            tripFilter={tripFilter}
            onTripFilter={setTripFilter}
            onUpdate={updateData}
            onEdit={() => navigate('edit')}
            onEditTrip={editTrip}
            onLoadExample={loadExample}
            {...future}
          />
        )}
        {view === 'stats' && (
          <StatsView data={data} stats={stats} statsNow={statsNow} onUpdate={updateData} onShow={(s) => navigate('explore', s)} {...future} />
        )}
        {/* Kept mounted so unsaved edits survive switching tabs. */}
        <div hidden={view !== 'edit'} className="edit-host">
          <EditView data={data} stats={statsNow} lookup={lookup} active={view === 'edit'} editRequest={editRequest} onLoadExample={loadExample} onSave={save} onDirtyChange={setEditDirty} />
        </div>
      </main>
    </div>
  );
}
