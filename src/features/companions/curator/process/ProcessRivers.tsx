import type { Station } from './engine/spine';
import { figures, type ProcessLane } from './lanes';
import { LaneHeadline, OutcomeStrip } from './LaneParts';

/**
 * Variant: Rivers.
 *
 * The Spine kept (start on top, end at the bottom), turned into a stream a column wide so four
 * processes stand side by side. The stream's width at each station is the share still on the
 * path; failed endings spill out of it to the right, stumbles mark its left bank. Station rows
 * share one height across lanes, so the n-th step of every process sits on the same line.
 */

const ROW = 72;
const W = 64;
const CX = 30;
const MAX = 42;

export function ProcessRivers({ lanes }: { lanes: ProcessLane[] }) {
  return (
    <div className="grid gap-5" style={{ gridTemplateColumns: `repeat(${Math.max(1, lanes.length)}, minmax(15rem, 1fr))` }}>
      {lanes.map((lane) => (
        <section
          key={lane.id}
          className="flex flex-col gap-6 rounded-card border border-primary/10 bg-secondary/20 p-5 shadow-elevation-1"
          data-testid={`process-lane-${lane.id}`}
        >
          <LaneHeadline lane={lane} />
          <River lane={lane} />
          <div className="mt-auto">
            <OutcomeStrip lane={lane} />
          </div>
        </section>
      ))}
    </div>
  );
}

function River({ lane }: { lane: ProcessLane }) {
  const { stations, n } = lane.model;
  const width = (s: Station) => Math.max(5, (MAX * s.reached) / (n || 1));
  return (
    <div className="relative grid grid-cols-[4rem_minmax(0,1fr)]">
      <svg width={W} height={stations.length * ROW} className="row-span-full" aria-hidden="true">
        <defs>
          <linearGradient id={`river-${lane.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--primary)', stopOpacity: 0.4 }} />
            <stop offset="1" style={{ stopColor: 'var(--primary)', stopOpacity: 0.08 }} />
          </linearGradient>
        </defs>
        <path d={streamPath(stations.map(width))} fill={`url(#river-${lane.id})`} className="stroke-primary/40" strokeWidth={1} />
        {stations.map((s, i) => {
          const y = i * ROW + 13;
          const w = width(s);
          const f = figures(lane, s);
          const spill = Math.min(12, Math.max(2.5, (MAX * s.exits) / (n || 1)));
          return (
            <g key={s.index}>
              {s.exits > 0 && (
                <path
                  d={`M ${CX + w / 2 - 2} ${y + 3} C ${CX + w / 2 + 8} ${y + 8}, ${W - 12} ${y + 16}, ${W - 10} ${y + 34}`}
                  className="fill-none stroke-status-error"
                  strokeWidth={spill}
                  strokeLinecap="round"
                  opacity={0.85}
                />
              )}
              <circle
                cx={CX}
                cy={y}
                r={f.rank === 1 ? 8 : 6.5}
                className={`fill-background ${f.rank === 1 ? 'stroke-status-error' : 'stroke-primary'}`}
                strokeWidth={2.5}
              />
            </g>
          );
        })}
      </svg>
      <ol className="col-start-2 row-start-1">
        {stations.map((s) => (
          <RiverStation key={s.index} lane={lane} station={s} />
        ))}
      </ol>
    </div>
  );
}

function RiverStation({ lane, station: s }: { lane: ProcessLane; station: Station }) {
  const f = figures(lane, s);
  const worst = f.rank === 1;
  return (
    <li className="flex flex-col" style={{ height: ROW }} data-testid={`process-lane-${lane.id}-station-${s.index}`}>
      <div className="flex items-center gap-2">
        <span className={`typo-heading truncate ${worst ? 'text-status-error' : 'text-foreground'}`}>{lane.stationName(s.keys)}</span>
        {f.rank != null && (
          <span className="rounded-pill bg-status-error/15 px-2 py-0.5 typo-caption tabular-nums text-status-error">{`No. ${f.rank}`}</span>
        )}
      </div>
      {/* One line of figures, coloured by the page key: reached, failed here, stumbled here. */}
      <p className="mt-1 flex items-baseline gap-3 whitespace-nowrap tabular-nums">
        <span className="typo-data text-foreground">{f.reachedPct}%</span>
        {f.exitPct ? <span className="typo-data text-status-error">{f.exitPct}%</span> : null}
        {f.stumblePct ? <span className="typo-body text-status-warning">{f.stumblePct}%</span> : null}
      </p>
    </li>
  );
}

/** A closed stream: right bank down through every station, a rounded mouth, left bank back up. */
function streamPath(widths: number[]): string {
  if (!widths.length) return '';
  const y = (i: number) => i * ROW + 13;
  const last = widths.length - 1;
  const w0 = widths[0] ?? 5;
  const wl = widths[last] ?? 5;
  const mouth = y(last) + ROW * 0.5;
  let d = `M ${CX - w0 / 2} ${y(0) - 14} Q ${CX} ${y(0) - 20} ${CX + w0 / 2} ${y(0) - 14} L ${CX + w0 / 2} ${y(0)}`;
  for (let i = 0; i < last; i++) {
    const a = (widths[i] ?? 5) / 2, b = (widths[i + 1] ?? 5) / 2;
    d += ` C ${CX + a} ${y(i) + ROW / 2}, ${CX + b} ${y(i + 1) - ROW / 2}, ${CX + b} ${y(i + 1)}`;
  }
  d += ` L ${CX + wl / 2} ${mouth - wl / 2} Q ${CX + wl / 2} ${mouth} ${CX} ${mouth} Q ${CX - wl / 2} ${mouth} ${CX - wl / 2} ${mouth - wl / 2}`;
  d += ` L ${CX - wl / 2} ${y(last)}`;
  for (let i = last; i > 0; i--) {
    const a = (widths[i] ?? 5) / 2, b = (widths[i - 1] ?? 5) / 2;
    d += ` C ${CX - a} ${y(i) - ROW / 2}, ${CX - b} ${y(i - 1) + ROW / 2}, ${CX - b} ${y(i - 1)}`;
  }
  return `${d} Z`;
}
