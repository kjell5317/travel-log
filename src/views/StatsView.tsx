import { useMemo, useState } from 'react';
import { BarList, GrowthChart } from '../components/Charts';
import { FutureSwitch } from '../components/FutureSwitch';
import { fmtCompactKm, fmtInt, fmtKm, fmtPct, fmtTimes, plural } from '../lib/format';
import { EARTH_CIRCUMFERENCE_KM } from '../lib/geo';
import { continentsVisited, countryGrowth, flightMix, hoursInAir, records, tripsPerCountry, type Share } from '../lib/insights';
import { CONTINENTS, countryByCode, countryName } from '../lib/reference';
import { BASIS_LABELS, coverage, type AirportStat, type TravelStats } from '../lib/stats';
import type { CountryBasis, Selection, TravelData } from '../types';

interface Props {
  data: TravelData;
  /** Statistics currently shown (with planned trips when "Future" is on). */
  stats: TravelStats;
  /** Statistics of the done trips only, to compare against. */
  statsNow: TravelStats;
  onUpdate: (patch: Partial<TravelData>) => Promise<void>;
  onShow: (s: Selection) => void;
  showFuture: boolean;
  hasPlanned: boolean;
  onShowFuture: (on: boolean) => void;
}

const fmtHours = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} days` : `${Math.round(h)} h`);

export function StatsView({ data, stats, statsNow, onUpdate, onShow, showFuture, hasPlanned, onShowFuture }: Props) {
  const basis = data.settings.countryBasis;
  const covByBasis = useMemo(
    () => ({ 'un+observers': coverage(stats.countries, 'un+observers'), 'un+observers+visited': coverage(stats.countries, 'un+observers+visited') }),
    [stats],
  );
  const cov = covByBasis[basis];
  const covNow = useMemo(() => coverage(statsNow.countries, basis), [statsNow, basis]);
  const growth = useMemo(() => countryGrowth(stats), [stats]);
  const mix = useMemo(() => flightMix(stats), [stats]);
  const recordItems = useMemo(() => records(stats), [stats]);
  const topCountries = useMemo(() => tripsPerCountry(stats).slice(0, 10), [stats]);
  const continents = continentsVisited(stats);
  const missingContinents = Object.keys(CONTINENTS).filter((c) => !continents.includes(c)).map((c) => CONTINENTS[c]);
  const hours = hoursInAir(stats);
  const noFlightTrips = stats.trips.filter((t) => t.noFlight).length;
  const manualCountries = stats.countries.filter((c) => c.kind === 'manual').length;

  const delta = (now: number, then: number, format: (n: number) => string = fmtInt) =>
    showFuture && then > now ? `+${format(then - now)} planned` : undefined;

  return (
    <div className="stats">
      <div className="stats-toolbar">
        <FutureSwitch showFuture={showFuture} hasPlanned={hasPlanned} onShowFuture={onShowFuture} />
      </div>

      <section className="hero card">
        <div className="hero-figure">{fmtPct(cov.pct)}</div>
        <div className="hero-text">
          <p>
            of the world visited — <strong>{fmtInt(cov.visited)}</strong> of {fmtInt(cov.total)}
            {showFuture && cov.visited > covNow.visited && (
              <span className="muted"> · now {fmtPct(covNow.pct)}, planned trips add {plural(cov.visited - covNow.visited, 'country', 'countries')}</span>
            )}
          </p>
        </div>
        <div className="basis-options" role="radiogroup" aria-label="What counts as a country">
          {(Object.keys(BASIS_LABELS) as CountryBasis[]).map((b) => {
            const option = covByBasis[b];
            const others = covByBasis['un+observers'].outside;
            const detail =
              b === 'un+observers'
                ? 'The 193 UN member states, plus Vatican City and Palestine.'
                : others.length
                  ? `Adds ${others.map((c) => `${c.country?.flag ?? ''} ${c.country?.name ?? c.code}`).join(', ')} to what you’ve visited and to the total.`
                  : 'No other places yet — places like Hong Kong, Kosovo or Taiwan would be added here.';
            return (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={basis === b}
                className={`basis-option${basis === b ? ' active' : ''}`}
                onClick={() => basis !== b && onUpdate({ settings: { ...data.settings, countryBasis: b } })}
              >
                <span className="basis-radio" aria-hidden />
                <span className="basis-body">
                  <span className="basis-title">{BASIS_LABELS[b]}</span>
                  <span className="basis-numbers">
                    <strong>{fmtPct(option.pct)}</strong> · {fmtInt(option.visited)} of {fmtInt(option.total)}
                  </span>
                  <span className="basis-detail">{detail}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="continents">
          {cov.byContinent.map((c) => (
            <div key={c.continent} className="meter-row">
              <span className="meter-label">{c.name}</span>
              <span className="meter" role="meter" aria-valuenow={c.visited} aria-valuemax={c.total} aria-label={c.name}>
                <span style={{ width: `${(c.visited / c.total) * 100}%` }} />
              </span>
              <span className="meter-value">
                {c.visited} / {c.total}
              </span>
            </div>
          ))}
        </div>
      </section>

      {showFuture && <PlannedImpact stats={stats} statsNow={statsNow} covNow={covNow.pct} covFuture={cov.pct} onShow={onShow} />}

      <section className="tiles">
        <Tile label="Flights" value={fmtInt(stats.flights.length)} sub={delta(statsNow.flights.length, stats.flights.length)} />
        <Tile
          label="Trips"
          value={fmtInt(stats.trips.length)}
          sub={delta(statsNow.trips.length, stats.trips.length) ?? (noFlightTrips ? `${noFlightTrips} without flying` : undefined)}
        />
        <Tile label="Countries" value={fmtInt(stats.countries.length)} sub={delta(statsNow.countries.length, stats.countries.length)} />
        <Tile label="Continents" value={`${continents.length} of 7`} sub={missingContinents.length <= 3 ? `Not yet: ${missingContinents.join(', ')}` : undefined} />
        <Tile label="Airports" value={fmtInt(stats.airports.length)} sub={delta(statsNow.airports.length, stats.airports.length)} />
        <Tile label="Distance flown" value={fmtCompactKm(stats.totalKm)} sub={delta(statsNow.totalKm, stats.totalKm, fmtCompactKm)} />
        <Tile label="Time in the air" value={`≈ ${fmtHours(hours)}`} sub="estimated" />
        <Tile label="Around the Earth" value={fmtTimes(stats.totalKm / EARTH_CIRCUMFERENCE_KM)} />
      </section>

      <section className="card">
        <h2>Countries over time</h2>
        <p className="card-sub">Countries visited over time. Dots mark when you added new countries; bigger dots mean several trips in that quarter. Hover for details.</p>
        {growth.length ? <GrowthChart points={growth} /> : <p className="muted">No trips yet.</p>}
        {manualCountries > 0 && <p className="muted small">Not shown: {plural(manualCountries, 'country', 'countries')} added by hand.</p>}
      </section>

      <div className="stats-grid">
        <section className="card">
          <h2>Where you flew</h2>
          <MixBars shares={mix.where} />
          <h2 className="subhead">How far</h2>
          <MixBars shares={mix.distance} />
        </section>

        <section className="card">
          <h2>Records</h2>
          <dl className="records">
            {recordItems.map((r) => (
              <div key={r.label} className={r.show ? 'clickable' : undefined} onClick={r.show ? () => onShow(r.show!) : undefined}>
                <dt>{r.label}</dt>
                <dd>
                  <strong>{r.value}</strong>
                  <span className="muted">{r.detail}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card">
          <h2>Countries you keep coming back to</h2>
          <p className="card-sub">Trips that started or ended in each country.</p>
          <BarList
            items={topCountries.map(({ code, trips }) => ({
              key: code,
              label: `${countryByCode.get(code)?.flag ?? ''} ${countryName(code)}`,
              value: trips,
              valueLabel: plural(trips, 'trip'),
              planned: stats.countryByCode.get(code)?.planned,
              onClick: () => onShow({ kind: 'country', code }),
            }))}
          />
        </section>

        <ContinentList stats={stats} onShow={onShow} />
        <AirportsTable stats={stats} onShow={onShow} />
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile card">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

function MixBars({ shares }: { shares: Share[] }) {
  const total = shares.reduce((n, s) => n + s.count, 0);
  return (
    <BarList
      items={shares.map((s) => ({
        key: s.label,
        label: s.label,
        hint: s.hint,
        value: s.count,
        valueLabel: total ? `${s.count} · ${Math.round((s.count / total) * 100)}%` : '0',
      }))}
    />
  );
}

function PlannedImpact({
  stats,
  statsNow,
  covNow,
  covFuture,
  onShow,
}: {
  stats: TravelStats;
  statsNow: TravelStats;
  covNow: number;
  covFuture: number;
  onShow: (s: Selection) => void;
}) {
  const newCountries = stats.countries.filter((c) => c.planned);
  const newAirports = stats.airports.filter((a) => a.planned).length;
  const plannedTrips = stats.trips.filter((t) => t.planned);
  return (
    <section className="card impact">
      <h2>
        <i className="swatch swatch-planned" /> What your {plural(plannedTrips.length, 'planned trip')} would add
      </h2>
      <div className="impact-grid">
        <div>
          <span>Share of the world</span>
          <strong>
            {fmtPct(covNow)} → {fmtPct(covFuture)}
          </strong>
        </div>
        <div>
          <span>Countries</span>
          <strong>
            {statsNow.countries.length} → {stats.countries.length}
          </strong>
        </div>
        <div>
          <span>Flights</span>
          <strong>+{fmtInt(stats.flights.length - statsNow.flights.length)}</strong>
        </div>
        <div>
          <span>Distance</span>
          <strong>+{fmtKm(stats.totalKm - statsNow.totalKm)}</strong>
        </div>
        <div>
          <span>New airports</span>
          <strong>+{fmtInt(newAirports)}</strong>
        </div>
      </div>
      {newCountries.length > 0 ? (
        <div className="chips">
          {newCountries.map((c) => (
            <button key={c.code} type="button" className="chip chip-planned" onClick={() => onShow({ kind: 'country', code: c.code })}>
              {c.country?.flag} {c.country?.name ?? c.code}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted small">No new countries — your planned trips only go to places you’ve been.</p>
      )}
    </section>
  );
}

function ContinentList({ stats, onShow }: { stats: TravelStats; onShow: (s: Selection) => void }) {
  const groups = Object.entries(CONTINENTS)
    .map(([code, name]) => ({ code, name, countries: stats.countries.filter((c) => c.country?.continent === code) }))
    .filter((g) => g.countries.length);
  return (
    <section className="card">
      <h2>Countries by continent</h2>
      {groups.map((g) => (
        <div key={g.code} className="continent-group">
          <h3>
            {g.name} <span className="muted">{g.countries.length}</span>
          </h3>
          <div className="chips">
            {g.countries.map((c) => (
              <button
                key={c.code}
                type="button"
                className={`chip${c.planned ? ' chip-planned' : ''}`}
                title={c.firstTrip != null ? `First: ${stats.trips[c.firstTrip].trip.name || `trip ${c.firstTrip + 1}`}` : 'Added by hand'}
                onClick={() => onShow({ kind: 'country', code: c.code })}
              >
                {c.country?.flag} {c.country?.name ?? c.code}
              </button>
            ))}
          </div>
        </div>
      ))}
      {stats.transitOnly.length > 0 && (
        <p className="muted small">Transit only: {stats.transitOnly.map((c) => `${c.country?.flag ?? ''} ${countryName(c.code)}`).join(', ')}</p>
      )}
    </section>
  );
}

type AirportSort = 'visits' | 'departures' | 'arrivals' | 'transfers' | 'code';

function AirportsTable({ stats, onShow }: { stats: TravelStats; onShow: (s: Selection) => void }) {
  const [sort, setSort] = useState<AirportSort>('visits');
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(
    () =>
      [...stats.airports].sort((a, b) =>
        sort === 'code' ? a.code.localeCompare(b.code) : b[sort] - a[sort] || b.visits - a.visits || a.code.localeCompare(b.code),
      ),
    [stats, sort],
  );
  const rows = showAll ? sorted : sorted.slice(0, 12);
  const header = (key: AirportSort, label: string, num = true) => (
    <th className={num ? 'num' : undefined} aria-sort={sort === key ? 'descending' : undefined}>
      <button type="button" className={`sort${sort === key ? ' active' : ''}`} onClick={() => setSort(key)}>
        {label}
      </button>
    </th>
  );
  return (
    <section className="card">
      <h2>Airports</h2>
      <table>
        <thead>
          <tr>
            {header('code', 'Airport', false)}
            {header('visits', 'Visits')}
            {header('departures', 'Dep.')}
            {header('arrivals', 'Arr.')}
            {header('transfers', 'Transfer')}
          </tr>
        </thead>
        <tbody>
          {rows.map((a: AirportStat) => (
            <tr key={a.code} className="clickable" onClick={() => onShow({ kind: 'airport', code: a.code })}>
              <td>
                <strong>{a.code}</strong> <span className="muted">{a.airport ? `${a.airport.city || a.airport.name}, ${countryName(a.airport.country)}` : 'unknown'}</span>
                {a.planned && <span className="tag tag-planned">planned</span>}
              </td>
              <td className="num">{a.visits}</td>
              <td className="num">{a.departures}</td>
              <td className="num">{a.arrivals}</td>
              <td className="num">{a.transfers || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > 12 && (
        <button type="button" className="link small" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show top 12' : `Show all ${sorted.length}`}
        </button>
      )}
    </section>
  );
}
