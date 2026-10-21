import { geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-50m.json';
import { fmtInt, fmtKm, plural } from '../lib/format';
import { countryByCcn3, countryName } from '../lib/reference';
import { surfaceLayer, type Hop } from '../lib/routes';
import { aggregate, visitStatus, type AirportStat, type RouteStat, type TravelStats } from '../lib/stats';
import type { Airport, CountryCode, Selection } from '../types';
import { FutureSwitch } from './FutureSwitch';

type CountryFeature = Feature<Geometry, { name: string }> & { code: CountryCode | null };

// Shapes in Natural Earth without an ISO numeric id.
const NAME_FALLBACK: Record<string, CountryCode> = { Kosovo: 'XK', 'N. Cyprus': 'CY', Somaliland: 'SO' };

const topology = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const COUNTRY_FEATURES: CountryFeature[] = (
  feature(topology, topology.objects.countries) as FeatureCollection<Geometry, { name: string }>
).features.map((f) => ({
  ...f,
  code: countryByCcn3.get(String(f.id))?.code ?? NAME_FALLBACK[f.properties.name] ?? null,
}));

// Frame the inhabited world rather than the whole sphere (most of Antarctica stays off-screen).
const FRAME: GeoPermissibleObjects = {
  type: 'MultiPoint',
  coordinates: [[-180, 0], [180, 0], [0, 84], [0, -57], [-180, 84], [180, -57]],
};

const MAX_ZOOM = 16;
const ROUTE_MODE_KEY = 'travel.routes';
const HOME_ROUTES_KEY = 'travel.homeRoutes';

type RouteMode = 'none' | 'flights' | 'surface' | 'all';
const ROUTE_MODES: { value: RouteMode; label: string }[] = [
  { value: 'none', label: 'No routes' },
  { value: 'flights', label: 'Flights' },
  { value: 'surface', label: 'No flights' },
  { value: 'all', label: 'All routes' },
];

function readHomeRoutes(): boolean {
  try {
    return localStorage.getItem(HOME_ROUTES_KEY) === 'true';
  } catch {
    return false;
  }
}

function readRouteMode(): RouteMode {
  try {
    const stored = localStorage.getItem(ROUTE_MODE_KEY);
    return ROUTE_MODES.some((m) => m.value === stored) ? (stored as RouteMode) : 'all';
  } catch {
    return 'all';
  }
}

/** Places that only no-flight trips reach are labelled by name (their code is just a stand-in). */
function placeName(p: Airport): string {
  return p.city || p.name;
}

function fitProjection(width: number, height: number) {
  return geoNaturalEarth1().fitExtent([[12, 12], [Math.max(width - 12, 13), Math.max(height - 12, 13)]], FRAME);
}

interface Props {
  stats: TravelStats;
  tripFilter: number | null;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  showFuture: boolean;
  hasPlanned: boolean;
  onShowFuture: (on: boolean) => void;
}

interface Tooltip {
  x: number;
  y: number;
  flip: boolean;
  content: ReactNode;
}

export function WorldMap({ stats, tripFilter, selection, onSelect, showFuture, hasPlanned, onShowFuture }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [routeMode, setRouteModeState] = useState(readRouteMode);
  // No-flight connections into and out of the home country are hidden unless this is on.
  const [showHomeRoutes, setShowHomeRoutesState] = useState(readHomeRoutes);
  const setShowHomeRoutes = (on: boolean) => {
    setShowHomeRoutesState(on);
    try {
      localStorage.setItem(HOME_ROUTES_KEY, String(on));
    } catch {
      // Not remembered when storage is unavailable.
    }
  };
  const showFlights = routeMode === 'flights' || routeMode === 'all';
  const showSurface = routeMode === 'surface' || routeMode === 'all';
  // "No flights" shows only trips without flying, so airport dots go too.
  const showAirports = routeMode !== 'surface';
  // Places of no-flight trips; with "No routes" every city you've been to is shown (not country markers).
  const showStops = routeMode !== 'flights';
  const showCountryStops = routeMode !== 'none';

  // A choice made while one trip is shown only applies to that view; the overview setting is what's remembered.
  const setRouteMode = (mode: RouteMode) => {
    setRouteModeState(mode);
    if (tripFilter != null) return;
    try {
      localStorage.setItem(ROUTE_MODE_KEY, mode);
    } catch {
      // Not remembered when storage is unavailable.
    }
  };

  // Showing one trip switches to its kind of routes; back on all trips, the earlier choice returns.
  const overviewMode = useRef<RouteMode | null>(null);
  const currentMode = useRef(routeMode);
  currentMode.current = routeMode;
  useEffect(() => {
    if (tripFilter == null) {
      if (overviewMode.current) setRouteModeState(overviewMode.current);
      overviewMode.current = null;
      return;
    }
    const trip = stats.trips[tripFilter];
    if (!trip) return;
    overviewMode.current ??= currentMode.current;
    const partlySurface = stats.surfaceLegs.some((leg) => leg.tripIndex === tripFilter);
    setRouteModeState(trip.noFlight ? 'surface' : partlySurface ? 'all' : 'flights');
    // Only a change of the shown trip switches the routes, not every data update.
  }, [tripFilter]);

  useLayoutEffect(() => {
    const el = containerRef.current!;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const projection = useMemo(() => fitProjection(size.width, size.height), [size]);
  const path = useMemo(() => geoPath(projection), [projection]);
  // Routes are drawn at zoom level 1 and scaled up, so resample great circles finely enough to stay smooth at max zoom.
  const routePath = useMemo(() => geoPath(fitProjection(size.width, size.height).precision(0.05)), [size]);

  useEffect(() => {
    const svg = select(svgRef.current!);
    const behavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, MAX_ZOOM])
      .translateExtent([[0, 0], [size.width, size.height]])
      .on('zoom', (event) => setTransform(event.transform));
    svg.call(behavior).on('dblclick.zoom', null);
    zoomRef.current = behavior;
    return () => {
      svg.on('.zoom', null);
    };
  }, [size]);

  // Data for the visible trip(s).
  const visible = useMemo(() => {
    const flown =
      tripFilter == null
        ? { airports: stats.airports, routes: stats.routes }
        : aggregate(
            stats.legs.filter((l) => l.tripIndex === tripFilter),
            stats.flights.filter((f) => f.tripIndex === tripFilter),
            (code) => stats.airportByCode.get(code)?.airport,
          );
    // Trips without flights: one line per pair of places, plus a small dot for places without an airport dot.
    const drawn = new Set(showAirports ? flown.airports.map((a) => a.code) : []);
    const home = stats.countries.find((c) => c.home)?.code;
    const hopsByTrip = new Map<number, Hop[]>();
    // Travel without flying inside a flight trip isn't a way out of or back home, so it's always drawn.
    const keptHops: Hop[][] = [];
    for (const leg of stats.surfaceLegs) {
      if (tripFilter != null && leg.tripIndex !== tripFilter) continue;
      const hops = leg.noFlightTrip ? (hopsByTrip.get(leg.tripIndex) ?? []) : [];
      for (let i = 0; i < leg.places.length - 1; i++) hops.push({ a: leg.places[i], b: leg.places[i + 1], planned: leg.planned });
      if (leg.noFlightTrip) hopsByTrip.set(leg.tripIndex, hops);
      else keptHops.push(hops);
    }
    const { segments, stops } = surfaceLayer([...hopsByTrip.values()], showHomeRoutes ? undefined : home, drawn, keptHops);
    return { ...flown, surface: segments, stops };
  }, [stats, tripFilter, showAirports, showHomeRoutes]);

  // Zoom to the selected trip, or back out when the filter is cleared. Only the filter
  // (or a resize) moves the camera; saving data must not reset the user's zoom.
  const latest = useRef({ visible, projection });
  latest.current = { visible, projection };
  useEffect(() => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (!svg || !behavior || !size.width) return;
    const { visible, projection } = latest.current;
    let target = zoomIdentity;
    if (tripFilter != null) {
      const places = [
        ...visible.airports.flatMap((a) => (a.airport ? [a.airport] : [])),
        ...visible.surface.flatMap((seg) => [seg.a, seg.b]),
        ...visible.stops.map((stop) => stop.place),
      ];
      const points = places.map((p) => projection([p.lon, p.lat])!);
      if (points.length) {
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const k = Math.min(8, 0.75 / Math.max((x1 - x0) / size.width, (y1 - y0) / size.height, 0.05));
        target = zoomIdentity
          .translate(size.width / 2, size.height / 2)
          .scale(Math.max(1, k))
          .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
      }
    }
    select(svg).transition().duration(600).call(behavior.transform, target);
  }, [tripFilter, size]);

  const zoomBy = (factor: number) => {
    if (svgRef.current && zoomRef.current) select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, factor);
  };
  const resetZoom = () => {
    if (svgRef.current && zoomRef.current) select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, zoomIdentity);
  };

  const homeCountry = stats.countries.find((c) => c.home)?.code;
  const selectedFlight = selection?.kind === 'flight' ? stats.flights[selection.index] : undefined;
  const selectedAirport = selection?.kind === 'airport' ? selection.code : null;
  const selectedCountry = selection?.kind === 'country' ? selection.code : null;

  const routeState = (route: RouteStat): 'normal' | 'after' | 'dim' => {
    if (selectedFlight) return route.flights.some((i) => i < selectedFlight.index) ? 'normal' : 'after';
    if (selectedAirport) return route.a === selectedAirport || route.b === selectedAirport ? 'normal' : 'dim';
    return 'normal';
  };

  const maxCount = Math.max(1, ...visible.routes.map((r) => r.count));
  // Thick enough that dashed (planned) routes stay visible; more flights on a route make it thicker.
  const routeWidth = (count: number) => 2 + 2 * Math.sqrt((count - 1) / Math.max(1, maxCount - 1));

  const arc = (a: Airport, b: Airport) => routePath({ type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] });
  const lineFor = (route: { a: string; b: string }) => {
    const a = stats.airportByCode.get(route.a)?.airport;
    const b = stats.airportByCode.get(route.b)?.airport;
    return a && b ? arc(a, b) : null;
  };

  const showTip = useCallback((event: React.MouseEvent, content: ReactNode) => {
    const box = containerRef.current!.getBoundingClientRect();
    const x = event.clientX - box.left;
    setTooltip({ x, y: event.clientY - box.top, flip: x > box.width - 280, content });
  }, []);
  const hideTip = useCallback(() => setTooltip(null), []);

  const maxVisits = Math.max(1, ...visible.airports.map((a) => a.visits));
  const radius = (a: AirportStat) => 3.5 + 5 * Math.sqrt(a.visits / maxVisits);
  const labelled = new Set<string>();
  if (selectedFlight) labelled.add(selectedFlight.from).add(selectedFlight.to);
  if (selectedAirport) labelled.add(selectedAirport);
  if (transform.k >= 2.5) visible.airports.forEach((a) => labelled.add(a.code));
  // Without airport dots, still mark the ends of a selected flight (or a selected airport).
  const airportsShown = showAirports
    ? visible.airports
    : visible.airports.filter((a) => a.code === selectedAirport || a.code === selectedFlight?.from || a.code === selectedFlight?.to);

  return (
    <div className="map" ref={containerRef}>
      <svg ref={svgRef} width={size.width} height={size.height} onClick={() => onSelect(null)} role="img" aria-label="World map of visited countries and flown routes">
        <g transform={transform.toString()}>
          <path className="map-sphere" d={path({ type: 'Sphere' }) ?? undefined} />
          <CountryLayer
            path={path}
            stats={stats}
            selectedCountry={selectedCountry}
            onSelect={onSelect}
            onHover={showTip}
            onLeave={hideTip}
          />
          {showSurface && (
            <g className="surface">
              {visible.surface.map(({ key, a, b, planned }) => {
                const d = arc(a, b);
                if (!d) return null;
                const tip = (
                  <>
                    <strong>
                      {a.code} – {b.code}
                    </strong>
                    <div>
                      {a.city || a.name} – {b.city || b.name}
                    </div>
                    <div>No flight{planned ? ' · planned' : ''}</div>
                  </>
                );
                return (
                  <g key={key} className={planned ? 'planned' : undefined}>
                    <path d={d} className="route-casing" style={{ strokeWidth: 5.5 }} vectorEffect="non-scaling-stroke" />
                    <path d={d} className="surface-line" vectorEffect="non-scaling-stroke" />
                    <path d={d} className="route-hit surface-hit" vectorEffect="non-scaling-stroke" onMouseMove={(e) => showTip(e, tip)} onMouseLeave={hideTip} />
                  </g>
                );
              })}
            </g>
          )}
          <g className="routes">
            {showFlights && visible.routes.map((route) => {
              const d = lineFor(route);
              if (!d) return null;
              const state = routeState(route);
              const tip = (
                <>
                  <strong>
                    {route.a} – {route.b}
                  </strong>
                  <div>
                    {countryName(stats.airportByCode.get(route.a)?.airport?.country ?? '')} · {countryName(stats.airportByCode.get(route.b)?.airport?.country ?? '')}
                  </div>
                  <div>
                    {plural(route.count, 'flight')} · {fmtKm(route.km)}
                    {route.planned ? ' · planned' : ''}
                  </div>
                </>
              );
              return (
                <g key={route.key} className={`route route-${state}${route.planned ? ' planned' : ''}`}>
                  <path d={d} className="route-casing" style={{ strokeWidth: routeWidth(route.count) + 3 }} vectorEffect="non-scaling-stroke" />
                  <path d={d} className="route-line" style={{ strokeWidth: routeWidth(route.count) }} vectorEffect="non-scaling-stroke" />
                  <path
                    d={d}
                    className="route-hit"
                    vectorEffect="non-scaling-stroke"
                    onMouseMove={(e) => showTip(e, tip)}
                    onMouseLeave={hideTip}
                    onClick={(e) => {
                      e.stopPropagation();
                      const candidates = selectedFlight ? route.flights.filter((i) => i !== selectedFlight.index) : route.flights;
                      onSelect({ kind: 'flight', index: candidates[0] ?? route.flights[0] });
                    }}
                  />
                </g>
              );
            })}
          </g>
          {selectedFlight && (
            <path className="route-casing" style={{ strokeWidth: 6 }} d={lineFor({ a: selectedFlight.from, b: selectedFlight.to }) ?? undefined} vectorEffect="non-scaling-stroke" />
          )}
          {selectedFlight && (
            <path
              className="route-selected"
              d={lineFor({ a: selectedFlight.from, b: selectedFlight.to }) ?? undefined}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
        <g className="airports">
          {showStops &&
            tripFilter == null &&
            stats.extraPlaces.map((p, i) => {
              const point = projection([p.lon, p.lat]);
              if (!point) return null;
              const [x, y] = transform.apply(point);
              return (
                // Cities outside trips only show their name on hover.
                <g key={`${p.name}-${p.country}-${i}`} className="surface-stop extra-city">
                  <circle cx={x} cy={y} r={3.5} className="surface-dot" />
                  <circle
                    cx={x}
                    cy={y}
                    r={9}
                    className="airport-hit"
                    onMouseMove={(e) =>
                      showTip(
                        e,
                        <>
                          <strong>
                            {p.name}, {countryName(p.country)}
                          </strong>
                          <div>Visited without a trip</div>
                        </>,
                      )
                    }
                    onMouseLeave={hideTip}
                  />
                </g>
              );
            })}
          {showStops &&
            visible.stops.map(({ place: p, planned }) => {
              if (p.type === 'K' && !showCountryStops) return null;
              const point = projection([p.lon, p.lat]);
              if (!point) return null;
              const [x, y] = transform.apply(point);
              return (
                <g key={p.code} className={`surface-stop${planned ? ' planned' : ''}${p.type === 'K' ? ' country-center' : ''}`}>
                  {p.type === 'K' ? (
                    <rect x={x - 4.5} y={y - 4.5} width={9} height={9} transform={`rotate(45 ${x} ${y})`} className="surface-dot" />
                  ) : (
                    <circle cx={x} cy={y} r={3.5} className="surface-dot" />
                  )}
                  {/* Country markers carry no name. */}
                  {transform.k >= 2.5 && p.type !== 'K' && (
                    <text x={x + 6} y={y} dy="0.35em" className="airport-label">
                      {placeName(p)}
                    </text>
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={9}
                    className="airport-hit"
                    onMouseMove={(e) =>
                      showTip(
                        e,
                        <>
                          <strong>
                            {p.type === 'K' ? `${p.name} (${p.code})` : `${p.code} · ${p.city || p.name}`}
                          </strong>
                          {p.type === 'K' && <div>Marked in the middle of the country</div>}
                          <div>{planned ? 'Planned, without flying' : 'Visited without flying'}</div>
                        </>,
                      )
                    }
                    onMouseLeave={hideTip}
                  />
                </g>
              );
            })}
          {airportsShown.map((a) => {
            if (!a.airport) return null;
            const p = projection([a.airport.lon, a.airport.lat]);
            if (!p) return null;
            const [x, y] = transform.apply(p);
            const isEndpoint = selectedFlight && (a.code === selectedFlight.from || a.code === selectedFlight.to);
            const dim = (selectedAirport && a.code !== selectedAirport && !stats.routes.some((r) => (r.a === selectedAirport && r.b === a.code) || (r.b === selectedAirport && r.a === a.code))) || false;
            return (
              <g
                key={a.code}
                className={`airport${isEndpoint || a.code === selectedAirport ? ' airport-selected' : ''}${dim ? ' airport-dim' : ''}${a.planned ? ' planned' : ''}`}
              >
                <circle cx={x} cy={y} r={radius(a)} className="airport-dot" />
                {labelled.has(a.code) && (
                  <text x={x + radius(a) + 3} y={y} dy="0.35em" className="airport-label">
                    {a.code}
                  </text>
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={Math.max(radius(a) + 4, 9)}
                  className="airport-hit"
                  onMouseMove={(e) =>
                    showTip(
                      e,
                      <>
                        <strong>
                          {a.code} · {a.airport!.city || a.airport!.name}
                        </strong>
                        <div>{a.airport!.name}</div>
                        <div>
                          {plural(a.visits, 'visit')} · {fmtInt(a.departures)} dep · {fmtInt(a.arrivals)} arr
                          {a.transfers ? ` · ${fmtInt(a.transfers)} transfer${a.transfers > 1 ? 's' : ''}` : ''}
                        </div>
                        {a.planned && <div>Planned — not visited yet</div>}
                      </>,
                    )
                  }
                  onMouseLeave={hideTip}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: 'airport', code: a.code });
                  }}
                />
              </g>
            );
          })}
        </g>
      </svg>

      <div className="map-options">
        <select value={routeMode} onChange={(e) => setRouteMode(e.target.value as RouteMode)} aria-label="Routes to show">
          {ROUTE_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        {homeCountry && showSurface && (
          <label className="pill-switch" title={`Show no-flight connections into and out of ${countryName(homeCountry)}`}>
            <input type="checkbox" role="switch" checked={showHomeRoutes} onChange={(e) => setShowHomeRoutes(e.target.checked)} />
            <span className="switch" aria-hidden />
            Home routes
          </label>
        )}
        <FutureSwitch showFuture={showFuture} hasPlanned={hasPlanned} onShowFuture={onShowFuture} />
      </div>

      <div className="map-controls">
        <button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={resetZoom} aria-label="Reset zoom" title="Reset zoom">
          ⟲
        </button>
      </div>

      <MapLegend
        hasHome={stats.countries.some((c) => c.home)}
        flightSelected={Boolean(selectedFlight)}
        showFlights={showFlights && visible.routes.length > 0}
        showSurface={showSurface && visible.surface.length > 0}
        showPlanned={showFuture}
      />

      {tooltip && (
        <div className={`tooltip${tooltip.flip ? ' tooltip-flip' : ''}`} style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.content}
        </div>
      )}
    </div>
  );
}

const CountryLayer = memo(function CountryLayer({
  path,
  stats,
  selectedCountry,
  onSelect,
  onHover,
  onLeave,
}: {
  path: ReturnType<typeof geoPath>;
  stats: TravelStats;
  selectedCountry: CountryCode | null;
  onSelect: (s: Selection) => void;
  onHover: (e: React.MouseEvent, content: ReactNode) => void;
  onLeave: () => void;
}) {
  const shapes = useMemo(() => COUNTRY_FEATURES.map((f) => ({ f, d: path(f) ?? '' })), [path]);
  return (
    <g className="countries">
      {shapes.map(({ f, d }, i) => {
        const stat = f.code ? stats.countryByCode.get(f.code) : undefined;
        const kind = stat?.home ? 'home' : stat?.kind === 'transit' ? 'transit' : stat?.planned ? 'planned' : stat ? 'visited' : 'none';
        const name = f.code ? countryName(f.code) : f.properties.name;
        const status = visitStatus(stat);
        return (
          <path
            key={`${f.id ?? f.properties.name}-${i}`}
            d={d}
            className={`country country-${kind}${f.code && f.code === selectedCountry ? ' country-selected' : ''}`}
            vectorEffect="non-scaling-stroke"
            onMouseMove={(e) =>
              onHover(
                e,
                <>
                  <strong>{name}</strong>
                  <div>{status}</div>
                </>,
              )
            }
            onMouseLeave={onLeave}
            onClick={(e) => {
              e.stopPropagation();
              if (f.code) onSelect({ kind: 'country', code: f.code });
            }}
          />
        );
      })}
    </g>
  );
});

function MapLegend({
  hasHome,
  flightSelected,
  showFlights,
  showSurface,
  showPlanned,
}: {
  hasHome: boolean;
  flightSelected: boolean;
  showFlights: boolean;
  showSurface: boolean;
  showPlanned: boolean;
}) {
  return (
    <div className="map-legend">
      {hasHome && (
        <span>
          <i className="swatch swatch-home" /> Home
        </span>
      )}
      <span>
        <i className="swatch swatch-visited" /> Visited
      </span>
      <span>
        <i className="swatch swatch-transit" /> Transit only
      </span>
      {showPlanned && (
        <span>
          <i className="swatch swatch-planned" /> Planned
        </span>
      )}
      {flightSelected && (
        <span>
          <i className="line-key line-key-selected" /> Selected flight
        </span>
      )}
      {showFlights && (
        <span>
          <i className="line-key" /> {flightSelected ? 'Flown before' : 'Flight'}
        </span>
      )}
      {showFlights && flightSelected && (
        <span>
          <i className="line-key line-key-after" /> Only after
        </span>
      )}
      {showSurface && (
        <span>
          <i className="line-key line-key-surface" /> No flight
        </span>
      )}
      {showPlanned && (showFlights || showSurface) && (
        <span>
          <i className="line-key line-key-planned" /> Planned (dashed)
        </span>
      )}
    </div>
  );
}
