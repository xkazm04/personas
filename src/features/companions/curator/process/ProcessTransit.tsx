import type { Station } from './engine/spine';
import { figures, PROTO, type ProcessLane } from './lanes';
import { LaneHeadline, OutcomeStrip } from './LaneParts';

/**
 * Variant: Transit.
 *
 * Each process is one line on a transit map, read left to right; four lines stack in the height
 * one Spine used to need. The track's thickness is the flow into the next stop. Every stop is a
 * dial: its centre is the share that reached it, its ring is what happened to them there
 * (failed endings in red, stumbles in amber, the rest clean). Stops are aligned by position, so
 * the third step of every process sits in the same column.
 */

const TRACK_MAX = 14;

export function ProcessTransit({ lanes }: { lanes: ProcessLane[] }) {
  const columns = Math.max(1, ...lanes.map((l) => l.model.stations.length));
  return (
    <div className="flex flex-col gap-3">
      {lanes.map((lane) => (
        <section
          key={lane.id}
          className="grid grid-cols-[16rem_minmax(0,1fr)_14rem] items-center gap-8 rounded-card border border-primary/10 bg-secondary/20 px-6 py-4 shadow-elevation-1"
          data-testid={`process-lane-${lane.id}`}
        >
          <LaneHeadline lane={lane} compact />
          <ol className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {lane.model.stations.map((s, i) => (
              <Stop key={s.index} lane={lane} station={s} next={lane.model.stations[i + 1]} first={i === 0} />
            ))}
          </ol>
          <OutcomeStrip lane={lane} stacked />
        </section>
      ))}
    </div>
  );
}

function Stop({ lane, station: s, next, first }: { lane: ProcessLane; station: Station; next?: Station; first: boolean }) {
  const f = figures(lane, s);
  const n = lane.model.n || 1;
  const thick = (x: Station) => Math.max(3, (TRACK_MAX * x.reached) / n);
  const worst = f.rank === 1;
  return (
    <li className="relative flex flex-col items-center text-center" data-testid={`process-lane-${lane.id}-station-${s.index}`}>
      {/* The track: into this stop from the left, out of it toward the next. */}
      {!first && (
        <span className="absolute left-0 right-1/2 bg-primary/30" style={{ top: 28 - thick(s) / 2, height: thick(s) }} aria-hidden="true" />
      )}
      {next && (
        <span className="absolute left-1/2 right-0 bg-primary/30" style={{ top: 28 - thick(next) / 2, height: thick(next) }} aria-hidden="true" />
      )}
      <Dial reachedPct={f.reachedPct} exitPct={f.exitPct ?? 0} stumblePct={f.stumblePct ?? 0} hot={worst} />
      <span className={`mt-2 typo-heading ${worst ? 'text-status-error' : 'text-foreground'}`}>{lane.stationName(s.keys)}</span>
      <span className={`typo-caption tabular-nums ${f.exitPct ? 'text-status-error' : f.stumblePct ? 'text-status-warning' : ''}`}>
        {f.exitPct ? `${f.exitPct}% ${PROTO.failed_short}` : f.stumblePct ? `${f.stumblePct}% ${PROTO.stumbled}` : PROTO.clean}
      </span>
    </li>
  );
}

const R = 22;
const C = 2 * Math.PI * R;

/** A stop: coverage in the centre, the fate of those who reached it around the ring. */
function Dial({ reachedPct, exitPct, stumblePct, hot }: { reachedPct: number; exitPct: number; stumblePct: number; hot: boolean }) {
  const red = (C * exitPct) / 100;
  const amber = (C * Math.min(stumblePct, 100 - exitPct)) / 100;
  return (
    <span className="relative z-10 block h-14 w-14" aria-hidden="true">
      <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
        <circle cx={28} cy={28} r={R + 4} className="fill-background" />
        <circle cx={28} cy={28} r={R} className="fill-none stroke-primary" strokeWidth={5} />
        {amber > 0 && (
          <circle cx={28} cy={28} r={R} className="fill-none stroke-status-warning" strokeWidth={5} strokeDasharray={`${amber} ${C}`} strokeDashoffset={-red} />
        )}
        {red > 0 && <circle cx={28} cy={28} r={R} className="fill-none stroke-status-error" strokeWidth={5} strokeDasharray={`${red} ${C}`} />}
        {hot && <circle cx={28} cy={28} r={R + 5} className="fill-none stroke-status-error/50" strokeWidth={1.5} />}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center typo-label tabular-nums text-foreground">{reachedPct}%</span>
    </span>
  );
}
