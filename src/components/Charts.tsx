import { curveMonotoneX, line } from 'd3-shape';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { formatTripDate, todayValue } from '../lib/dates';
import { fmtInt } from '../lib/format';
import type { GrowthPoint } from '../lib/insights';
import { countryByCode } from '../lib/reference';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Up to ~5 round ticks from 0 to at least `max`. */
function niceTicks(max: number): number[] {
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => max / s <= 5) ?? Math.ceil(max / 5);
  const top = Math.max(step, Math.ceil(max / step) * step);
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

const HEIGHT = 240;
const M = { top: 18, right: 28, bottom: 30, left: 36 };

const quarterLabel = (t: number) => {
  const year = Math.floor(t);
  return `Q${Math.min(4, Math.floor((t - year) * 4) + 1)} ${year}`;
};

/**
 * Countries visited over time, as steps (a trip adds its countries at once). With dated trips the
 * x axis is time and the line runs on to today; without dates it is the trip number.
 * Planned trips continue the line in the planned color.
 */
export function GrowthChart({ points, today = todayValue() }: { points: GrowthPoint[]; today?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const n = points.length;
  const timed = points.some((p) => p.time != null);
  const pos = points.map((p, i) => (timed ? p.time! : i + 1));
  const x0 = timed ? Math.floor(Math.min(...pos)) : 0;
  const x1 = timed ? Math.ceil(Math.max(...pos, today) + 1e-9) : n;
  const ticks = niceTicks(Math.max(1, ...points.map((p) => p.total)));
  const innerW = Math.max(1, width - M.left - M.right);
  const innerH = HEIGHT - M.top - M.bottom;
  const x = (v: number) => M.left + ((v - x0) / Math.max(1e-9, x1 - x0)) * innerW;
  const y = (v: number) => M.top + innerH - (v / ticks.at(-1)!) * innerH;

  const firstPlanned = points.findIndex((p) => p.trip.planned);
  const doneCount = firstPlanned === -1 ? n : firstPlanned;
  // Countries counted before the first trip (the home country).
  const base = n ? points[0].total - points[0].added.length : 0;
  const doneTotal = doneCount ? points[doneCount - 1].total : base;
  // A smooth curve through the trips; monotone, so it never overshoots a count. Trips at the same
  // spot (same quarter) collapse into their last one.
  const curve = (pts: [number, number][]) => {
    const merged: [number, number][] = [];
    for (const [px, py] of pts) {
      if (merged.length && Math.abs(merged[merged.length - 1][0] - px) < 1e-9) merged[merged.length - 1] = [px, py];
      else merged.push([px, py]);
    }
    return line<[number, number]>()
      .x(([px]) => x(px))
      .y(([, py]) => y(py))
      .curve(curveMonotoneX)(merged) ?? '';
  };
  const trail = (from: number, to: number) => points.slice(from, to).map((p, k): [number, number] => [pos[from + k], p.total]);

  // Trips at the same position (e.g. one quarter) form one spot: one dot, sized by how many trips it holds,
  // at the count after its last trip, which is where the curve passes.
  const spots: { first: number; last: number }[] = [];
  pos.forEach((v, i) => {
    const previous = spots.at(-1);
    if (previous && Math.abs(pos[previous.last] - v) < 1e-9) previous.last = i;
    else spots.push({ first: i, last: i });
  });
  const dotRadius = (trips: number) => Math.min(10, 4 * Math.sqrt(trips));
  // Done trips: flat from the last one until today (or until the first planned trip, if that comes earlier).
  const lastDone = doneCount ? pos[doneCount - 1] : x0;
  const doneEnd = timed ? Math.max(lastDone, Math.min(today, firstPlanned === -1 ? today : pos[firstPlanned])) : lastDone;
  const donePath = curve([[x0, base], ...trail(0, doneCount), [doneEnd, doneTotal]]);
  const plannedPath = firstPlanned === -1 ? null : curve([[doneEnd, doneTotal], ...trail(firstPlanned, n)]);

  const years = x1 - x0;
  const xTicks = timed
    ? Array.from({ length: years + 1 }, (_, k) => x0 + k).filter((_, k) => k % Math.max(1, Math.ceil(years / 10)) === 0)
    : Array.from({ length: n }, (_, k) => k + 1).filter((v) => v % Math.max(1, Math.ceil(n / 12)) === 0 || v === n);

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const mouse = M.left + e.clientX - box.left;
    let best: number | null = null;
    pos.forEach((v, i) => {
      if (best == null || Math.abs(x(v) - mouse) <= Math.abs(x(pos[best]) - mouse)) best = i;
    });
    setHover(best != null && Math.abs(x(pos[best]) - mouse) < 40 ? best : null);
  };

  // Trips drawn at the same spot (e.g. several in one quarter) are listed together.
  const hoverSpot = hover == null ? undefined : spots.find((spot) => spot.first <= hover && hover <= spot.last);
  const group = hoverSpot ? Array.from({ length: hoverSpot.last - hoverSpot.first + 1 }, (_, k) => hoverSpot.first + k) : [];
  const hoverIndex = group.at(-1);
  const hovered = hoverIndex != null ? points[hoverIndex] : null;
  const countryList = (codes: string[]) => codes.map((c) => `${countryByCode.get(c)?.flag ?? ''} ${countryByCode.get(c)?.name ?? c}`).join(', ');
  const whenLabel = (p: GrowthPoint) => (p.trip.date ? formatTripDate(p.trip.date) : `No date · around ${quarterLabel(p.time!)}`);
  return (
    <div className="chart" ref={ref}>
      {firstPlanned !== -1 && (
        <div className="chart-legend">
          <span>
            <i className="line-key line-key-accent" /> Done
          </span>
          <span>
            <i className="line-key line-key-accent-dashed" /> With planned trips
          </span>
        </div>
      )}
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={`Countries visited over ${n} trips, ending at ${points.at(-1)?.total ?? 0}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-baseline' : 'chart-grid'} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-tick">
                {t}
              </text>
            </g>
          ))}
          {xTicks.map((v) => (
            <text key={v} x={x(v)} y={HEIGHT - 8} textAnchor={timed ? 'start' : 'middle'} className="chart-tick">
              {v}
            </text>
          ))}
          {!timed && (
            <text x={M.left} y={HEIGHT - 8} textAnchor="start" className="chart-tick">
              Trip
            </text>
          )}
          {timed && today > x0 && today < x1 && (
            <g>
              <line x1={x(today)} x2={x(today)} y1={M.top} y2={M.top + innerH} className="chart-today" />
              <text x={x(today) + 4} y={M.top + innerH - 6} className="chart-tick">
                Today
              </text>
            </g>
          )}

          <path d={donePath} className="chart-line" />
          {plannedPath && <path d={plannedPath} className="chart-line chart-line-planned" />}
          {spots.map(({ first, last }) =>
            points.slice(first, last + 1).some((q) => q.added.length) ? (
              <circle
                key={points[last].trip.trip.id}
                cx={x(pos[last])}
                cy={y(points[last].total)}
                r={dotRadius(last - first + 1)}
                className={`chart-dot${points[last].trip.planned ? ' planned' : ''}`}
              />
            ) : null,
          )}
          {n > 0 && (
            <text x={x(plannedPath ? pos[n - 1] : doneEnd) + 8} y={y(points[n - 1].total)} dy="0.32em" className="chart-end-label">
              {points[n - 1].total}
            </text>
          )}

          {hovered && (
            <g pointerEvents="none">
              <line x1={x(pos[hoverIndex!])} x2={x(pos[hoverIndex!])} y1={M.top} y2={M.top + innerH} className="chart-crosshair" />
              <circle
                cx={x(pos[hoverIndex!])}
                cy={y(hovered.total)}
                r={dotRadius(group.length) + 1}
                className={`chart-dot chart-dot-hover${hovered.trip.planned ? ' planned' : ''}`}
              />
            </g>
          )}
          <rect x={M.left} y={M.top} width={innerW} height={innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
      )}
      {hovered && (
        <div
          className={`tooltip chart-tooltip${x(pos[hoverIndex!]) > width / 2 ? ' tooltip-flip' : ''}`}
          // Pinned to the top of the plot so longer lists (several trips in a quarter) stay inside the chart.
          style={{ left: x(pos[hoverIndex!]), top: M.top - 12 }}
        >
          {group.length === 1 ? (
            <>
              <strong>
                Trip {hoverIndex! + 1}: {hovered.trip.trip.name || 'Untitled'}
                {hovered.trip.planned ? ' (planned)' : ''}
              </strong>
              {timed && <div>{whenLabel(hovered)}</div>}
              <div>{fmtInt(hovered.total)} countries so far</div>
              {hovered.added.length > 0 && (
                <div>
                  +{hovered.added.length}: {countryList(hovered.added)}
                </div>
              )}
            </>
          ) : (
            <>
              <strong>
                {timed ? whenLabel(points[group[0]]) : 'Trips'} · {group.length} trips
              </strong>
              {group.map((i) => {
                const p = points[i];
                return (
                  <div key={p.trip.trip.id} className="chart-tooltip-trip">
                    <span className="chart-tooltip-name">
                      Trip {i + 1}: {p.trip.trip.name || 'Untitled'}
                      {p.trip.planned ? ' (planned)' : ''}
                      {timed && p.estimated && !points[group[0]].estimated ? ' · no date' : ''}
                    </span>
                    <span>{p.added.length ? `+${p.added.length}: ${countryList(p.added)}` : 'no new countries'}</span>
                  </div>
                );
              })}
              <div>{fmtInt(hovered.total)} countries so far</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export interface BarItem {
  key: string;
  label: ReactNode;
  hint?: string;
  value: number;
  valueLabel: string;
  planned?: boolean;
  onClick?: () => void;
}

/** Horizontal bars, one series, value at the tip. */
export function BarList({ items }: { items: BarItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="bar-list">
      {items.map((item) => (
        <li key={item.key} className={item.onClick ? 'clickable' : undefined} onClick={item.onClick} title={`${item.valueLabel}`}>
          <span className="bar-label">
            {item.label}
            {item.hint && <small>{item.hint}</small>}
          </span>
          <span className="bar-track">
            <span className={`bar${item.planned ? ' planned' : ''}`} style={{ width: `calc((100% - 64px) * ${item.value / max})` }} />
            <span className="bar-value">{item.valueLabel}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
