import { useEffect, useMemo, useRef, useState } from 'react';
import { WorldMap } from '../components/WorldMap';
import { formatTripDate } from '../lib/dates';
import { fmtInt, fmtKm, fmtPct, plural } from '../lib/format';
import { CONTINENTS, countryByCode, countryName } from '../lib/reference';
import { coverage, flightPosition, splitAtCountries, visitStatus, type TravelStats } from '../lib/stats';
import type { CountryCode, IATA, Selection, TravelData } from '../types';

interface Props {
  data: TravelData;
  stats: TravelStats;
  selection: Selection;
  onSelect: (s: Selection) => void;
  tripFilter: number | null;
  onTripFilter: (trip: number | null) => void;
  onUpdate: (patch: Partial<TravelData>) => Promise<void>;
  onEdit: () => void;
  /** Open the trip in the editor. */
  onEditTrip: (tripId: string) => void;
  onLoadExample: () => void;
  showFuture: boolean;
  hasPlanned: boolean;
  onShowFuture: (on: boolean) => void;
}

export function ExploreView({
  data,
  stats,
  selection,
  onSelect,
  tripFilter,
  onTripFilter,
  onUpdate,
  onEdit,
  onEditTrip,
  onLoadExample,
  showFuture,
  hasPlanned,
  onShowFuture,
}: Props) {
  const cov = useMemo(() => coverage(stats.countries, data.settings.countryBasis), [stats, data.settings.countryBasis]);

  // ← / → step through flights in order, Esc clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') onSelect(null);
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const visible = tripFilter == null ? stats.flights : stats.flights.filter((f) => f.tripIndex === tripFilter);
      if (!visible.length) return;
      const pos = selection?.kind === 'flight' ? visible.findIndex((f) => f.index === selection.index) : -1;
      const next = e.key === 'ArrowRight' ? Math.min(visible.length - 1, pos + 1) : pos === -1 ? visible.length - 1 : Math.max(0, pos - 1);
      onSelect({ kind: 'flight', index: visible[next].index });
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stats, selection, tripFilter, onSelect]);

  if (stats.flights.length === 0 && stats.countries.length === 0) {
    return (
      <div className="empty-state">
        <h2>No flights yet</h2>
        <p>Add your trips to see them on the map.</p>
        <div className="empty-actions">
          <button type="button" className="primary" onClick={onEdit}>
            Add trips
          </button>
          <button type="button" onClick={onLoadExample}>
            Load example
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="explore">
      <WorldMap
        stats={stats}
        tripFilter={tripFilter}
        selection={selection}
        onSelect={onSelect}
        showFuture={showFuture}
        hasPlanned={hasPlanned}
        onShowFuture={onShowFuture}
      />
      <aside className="sidebar">
        <div className="summary">
          <div>
            <strong>{fmtPct(cov.pct)}</strong>
            <span>of {fmtInt(cov.total)} countries</span>
          </div>
          <div>
            <strong>{fmtInt(stats.flights.length)}</strong>
            <span>flights</span>
          </div>
          <div>
            <strong>{fmtInt(stats.airports.length)}</strong>
            <span>airports</span>
          </div>
          <div>
            <strong>{fmtInt(Math.round(stats.totalKm / 1000))}k</strong>
            <span>km flown</span>
          </div>
        </div>

        {stats.unknownCodes.length > 0 && (
          <p className="notice">
            Unknown airport codes: {stats.unknownCodes.join(', ')}. They are left off the map.
          </p>
        )}

        {selection?.kind === 'flight' && <FlightDetail stats={stats} index={selection.index} onSelect={onSelect} onEditTrip={onEditTrip} />}
        {selection?.kind === 'airport' && <AirportDetail stats={stats} code={selection.code} onSelect={onSelect} />}
        {selection?.kind === 'country' && <CountryDetail data={data} stats={stats} code={selection.code} onSelect={onSelect} onUpdate={onUpdate} />}
        {!selection && <p className="hint">Click a flight, airport or country for details. Use ← → to step through your flights in order.</p>}

        <label className="trip-filter">
          <span>Show</span>
          <select value={tripFilter ?? ''} onChange={(e) => onTripFilter(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">All trips ({stats.trips.length})</option>
            {stats.trips.map((t) => (
              <option key={t.trip.id} value={t.index}>
                {t.index + 1}. {t.trip.name || 'Untitled trip'}
                {t.date ? ` · ${formatTripDate(t.date)}` : ''}
                {t.planned ? ' (planned)' : ''}
              </option>
            ))}
          </select>
        </label>

        <FlightList stats={stats} tripFilter={tripFilter} selection={selection} onSelect={onSelect} onEditTrip={onEditTrip} />
      </aside>
    </div>
  );
}

function FlightList({
  stats,
  tripFilter,
  selection,
  onSelect,
  onEditTrip,
}: {
  stats: TravelStats;
  tripFilter: number | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onEditTrip: (tripId: string) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = selection?.kind === 'flight' ? selection.index : null;
  const selectedTrip = selectedIndex != null ? stats.flights[selectedIndex]?.tripId : undefined;
  const filteredTrip = tripFilter != null ? stats.trips[tripFilter]?.trip.id : undefined;

  // Trips start collapsed; the trip of the selected flight (or the filtered trip) opens by itself.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [seen, setSeen] = useState({ selectedIndex, filteredTrip });
  if (seen.selectedIndex !== selectedIndex || seen.filteredTrip !== filteredTrip) {
    setSeen({ selectedIndex, filteredTrip });
    const open = [selectedTrip, filteredTrip].filter((id): id is string => Boolean(id) && !expanded.has(id!));
    if (open.length) setExpanded(new Set([...expanded, ...open]));
  }
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const trips = tripFilter == null ? stats.trips : stats.trips.filter((t) => t.index === tripFilter);
  return (
    <ol className="flight-list">
      {trips.map((t) => {
        const open = expanded.has(t.trip.id);
        return (
          <li key={t.trip.id} className="flight-list-trip">
            <div className="flight-list-trip-row">
              <button type="button" className="flight-list-trip-header" aria-expanded={open} onClick={() => toggle(t.trip.id)}>
                <span className="chevron" aria-hidden>
                  {open ? '▾' : '▸'}
                </span>
                <span className="trip-title">
                  {t.index + 1}. {t.trip.name || 'Untitled trip'}
                  {!t.noFlight && (
                    <span className="flight-mark" title="Flights" aria-label="flights">
                      ✈️
                    </span>
                  )}
                  {t.date && <span className="trip-date">{formatTripDate(t.date)}</span>}
                  {t.planned && <span className="tag tag-planned">planned</span>}
                </span>
                <span className="muted">{t.noFlight ? plural(t.legs, 'leg') : `${plural(t.flights, 'flight')} · ${fmtKm(t.km)}`}</span>
              </button>
              <button
                type="button"
                className="trip-edit"
                onClick={() => onEditTrip(t.trip.id)}
                title="Edit this trip"
                aria-label={`Edit trip ${t.trip.name || t.index + 1}`}
              >
                ✎
              </button>
            </div>
            {open &&
              t.noFlight &&
              stats.surfaceLegs
                .filter((leg) => leg.tripIndex === t.index)
                .map((leg) => (
                  <div key={leg.legIndex} className="flight-list-leg">
                    <span className="leg-label">Leg {leg.legIndex + 1}</span>
                    <span className="surface-row">{leg.codes.join(' → ')}</span>
                  </div>
                ))}
            {open && !t.noFlight && <FlightTripLegs stats={stats} trip={t} selectedIndex={selectedIndex} selectedRef={selectedRef} onSelect={onSelect} />}
          </li>
        );
      })}
    </ol>
  );
}

/** The legs of a flight trip: flights to click, plus any connections to country codes (no flight). */
function FlightTripLegs({
  stats,
  trip,
  selectedIndex,
  selectedRef,
  onSelect,
}: {
  stats: TravelStats;
  trip: TravelStats['trips'][number];
  selectedIndex: number | null;
  selectedRef: React.RefObject<HTMLButtonElement | null>;
  onSelect: (s: Selection) => void;
}) {
  // Flown parts appear in stats.legs in the same order splitAtCountries yields them.
  const flown = stats.legs.filter((leg) => leg.tripIndex === trip.index);
  let next = 0;
  return (
    <>
      {trip.trip.legs.map((codes, legIndex) => (
        <div key={legIndex} className="flight-list-leg">
          <span className="leg-label">Leg {legIndex + 1}</span>
          {splitAtCountries(codes).map((part, k) => {
            if (part.ground) {
              return (
                <span key={k} className="surface-row">
                  {part.codes.join(' → ')}
                  {part.codes.length === 1 && <span className="muted"> · visited</span>}
                </span>
              );
            }
            const leg = flown[next++];
            if (!leg) return null;
            return stats.flights.slice(leg.firstFlight, leg.firstFlight + leg.codes.length - 1).map((f) => (
              <button
                key={f.index}
                ref={f.index === selectedIndex ? selectedRef : undefined}
                type="button"
                className={`flight-row${f.index === selectedIndex ? ' selected' : ''}`}
                onClick={() => onSelect({ kind: 'flight', index: f.index })}
              >
                <span className="flight-number">#{f.index + 1}</span>
                <span className="flight-route">
                  {f.from} → {f.to}
                </span>
                <span className="muted">{fmtKm(f.km)}</span>
              </button>
            ));
          })}
        </div>
      ))}
    </>
  );
}

function place(code: IATA, stats: TravelStats) {
  const airport = stats.airportByCode.get(code)?.airport;
  if (!airport) return code;
  return `${airport.city || airport.name}, ${countryName(airport.country)}`;
}

export function FlightDetail({
  stats,
  index,
  onSelect,
  onEditTrip,
}: {
  stats: TravelStats;
  index: number;
  onSelect: (s: Selection) => void;
  onEditTrip: (tripId: string) => void;
}) {
  const flight = stats.flights[index];
  if (!flight) return null;
  const pos = flightPosition(stats, index);
  const trip = stats.trips[flight.tripIndex];
  const route = stats.routes.find((r) => r.flights.includes(index))!;
  const connection =
    flight.legFlights > 1
      ? flight.flightIndex === 0
        ? `continues to ${stats.legs[flight.legNumber].codes.at(-1)}`
        : `connection via ${flight.from}`
      : 'nonstop leg';

  return (
    <section className="detail">
      <div className="detail-eyebrow">
        {flight.planned ? 'Planned flight' : 'Flight'} {fmtInt(pos.number)} of {fmtInt(pos.total)}
      </div>
      <h2 className="detail-title">
        {flight.from} → {flight.to}
      </h2>
      <p className="detail-sub">
        {place(flight.from, stats)} → {place(flight.to, stats)}
      </p>
      <p className="detail-meta">
        {fmtKm(flight.km)} · {trip.trip.name || `Trip ${trip.index + 1}`}
        {trip.date ? ` (${formatTripDate(trip.date)})` : ''} · leg {flight.legIndex + 1} of {trip.legs}
        {flight.legFlights > 1 && ` · flight ${flight.flightIndex + 1} of ${flight.legFlights} (${connection})`}
      </p>

      <div className="position" aria-label={`${pos.done} flights done including this one, ${pos.after} after`}>
        <div className="position-bar">
          <span className="position-done" style={{ flexGrow: pos.done }} />
          <span className="position-this" />
          {pos.after > 0 && <span className="position-after" style={{ flexGrow: pos.after }} />}
        </div>
        <div className="position-labels">
          <span>
            <strong>{fmtPct(pos.donePct)}</strong> done · {plural(pos.done, 'flight')}
          </span>
          <span>
            <strong>{fmtPct(pos.afterPct)}</strong> after · {plural(pos.after, 'flight')}
          </span>
        </div>
        <div className="position-labels muted">
          <span>{fmtPct(pos.kmDonePct)} of your distance</span>
          <span>{fmtPct(pos.kmAfterPct)} of your distance</span>
        </div>
      </div>

      {route.count > 1 && (
        <p className="detail-meta">
          Route flown {route.count}×:{' '}
          {route.flights.map((i) => (
            <button key={i} type="button" className={`chip${i === index ? ' chip-active' : ''}`} onClick={() => onSelect({ kind: 'flight', index: i })}>
              #{i + 1}
            </button>
          ))}
        </p>
      )}

      <div className="detail-nav">
        <button type="button" disabled={index === 0} onClick={() => onSelect({ kind: 'flight', index: index - 1 })}>
          ← Previous
        </button>
        <button type="button" onClick={() => onEditTrip(flight.tripId)}>
          ✎ Edit trip
        </button>
        <button type="button" disabled={index === stats.flights.length - 1} onClick={() => onSelect({ kind: 'flight', index: index + 1 })}>
          Next →
        </button>
      </div>
    </section>
  );
}

function AirportDetail({ stats, code, onSelect }: { stats: TravelStats; code: IATA; onSelect: (s: Selection) => void }) {
  const stat = stats.airportByCode.get(code);
  if (!stat) return null;
  const routes = stats.routes.filter((r) => r.a === code || r.b === code);
  const rank = stats.airports.indexOf(stat) + 1;
  return (
    <section className="detail">
      <div className="detail-eyebrow">
        Airport · #{rank} most visited
      </div>
      <h2 className="detail-title">
        {code} · {stat.airport?.city || stat.airport?.name || 'Unknown'}
      </h2>
      <p className="detail-sub">
        {stat.airport?.name}
        {stat.airport && (
          <>
            {' · '}
            <button type="button" className="link" onClick={() => onSelect({ kind: 'country', code: stat.airport!.country })}>
              {countryByCode.get(stat.airport.country)?.flag} {countryName(stat.airport.country)}
            </button>
          </>
        )}
        {stat.airport?.type === 'C' && ' · closed'}
      </p>
      <dl className="mini-stats">
        <div>
          <dt>Visits</dt>
          <dd>{fmtInt(stat.visits)}</dd>
        </div>
        <div>
          <dt>Departures</dt>
          <dd>{fmtInt(stat.departures)}</dd>
        </div>
        <div>
          <dt>Arrivals</dt>
          <dd>{fmtInt(stat.arrivals)}</dd>
        </div>
        <div>
          <dt>Transfers</dt>
          <dd>{fmtInt(stat.transfers)}</dd>
        </div>
      </dl>
      <p className="detail-meta">
        First time here: <button type="button" className="link" onClick={() => onSelect({ kind: 'flight', index: stat.firstFlight })}>flight #{stat.firstFlight + 1}</button>
      </p>
      <ul className="route-list">
        {routes.map((r) => {
          const other = r.a === code ? r.b : r.a;
          return (
            <li key={r.key}>
              <button type="button" className="link" onClick={() => onSelect({ kind: 'flight', index: r.flights[0] })}>
                {code} – {other}
              </button>
              <span className="muted">
                {stats.airportByCode.get(other)?.airport?.city} · {r.count}×
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CountryDetail({
  data,
  stats,
  code,
  onSelect,
  onUpdate,
}: {
  data: TravelData;
  stats: TravelStats;
  code: CountryCode;
  onSelect: (s: Selection) => void;
  onUpdate: (patch: Partial<TravelData>) => Promise<void>;
}) {
  const country = countryByCode.get(code);
  const stat = stats.countryByCode.get(code);
  const manual = data.extraCountries.includes(code);
  const status = visitStatus(stat);
  const toggleManual = () =>
    onUpdate({ extraCountries: manual ? data.extraCountries.filter((c) => c !== code) : [...data.extraCountries, code].sort() });

  return (
    <section className="detail">
      <div className="detail-eyebrow">
        {country ? `${CONTINENTS[country.continent] ?? ''} · ${country.un ? 'UN member' : country.observer ? 'UN observer' : 'territory / other'}` : 'Country'}
      </div>
      <h2 className="detail-title">
        {country?.flag} {country?.name ?? code}
      </h2>
      <p className="detail-sub">{status}</p>
      {stat?.home && <p className="detail-meta">Counted as visited from the start.</p>}
      {stat && stat.firstTrip != null && (
        <p className="detail-meta">
          First trip here: {stats.trips[stat.firstTrip].trip.name || `Trip ${stat.firstTrip + 1}`}
        </p>
      )}
      {stat && stat.airports.length > 0 && (
        <p className="detail-meta">
          Airports:{' '}
          {stat.airports.map((a) => (
            <button key={a} type="button" className="chip" onClick={() => onSelect({ kind: 'airport', code: a })}>
              {a}
            </button>
          ))}
        </p>
      )}
      {!stat?.home && (!stat || stat.kind === 'transit' || manual) ? (
        <button type="button" onClick={toggleManual}>
          {manual ? 'Remove “visited without a trip”' : 'Mark as visited without a trip'}
        </button>
      ) : null}
    </section>
  );
}
