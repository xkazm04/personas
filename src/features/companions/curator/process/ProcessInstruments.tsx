import type { Station } from './engine/spine';
import { figures, PROTO, type ProcessLane } from './lanes';
import { LaneHeadline, OutcomeStrip, WorstCallout } from './LaneParts';

/**
 * Variant: Instruments.
 *
 * Each process is a card on an instrument panel: its headline, then its path as a stepped
 * funnel - one bar per station, its length the share that reached it, its red tip the share
 * that ended there failed - then the one station to look at, said plainly. Rows share one
 * height across cards, so the funnels compare shape to shape at a glance.
 */

const ROW = 58;

export function ProcessInstruments({ lanes }: { lanes: ProcessLane[] }) {
  // Every funnel takes the longest path's height, so the callouts below line up across cards.
  const rows = Math.max(1, ...lanes.map((l) => l.model.stations.length));
  return (
    <div className="grid gap-5" style={{ gridTemplateColumns: `repeat(${Math.max(1, lanes.length)}, minmax(15rem, 1fr))` }}>
      {lanes.map((lane) => (
        <section
          key={lane.id}
          className="flex flex-col gap-5 rounded-card border border-primary/10 bg-secondary/20 p-5 shadow-elevation-1"
          data-testid={`process-lane-${lane.id}`}
        >
          <LaneHeadline lane={lane} />
          <ol className="border-t border-primary/10 pt-2" style={{ minHeight: rows * ROW + 8 }}>
            {lane.model.stations.map((s) => (
              <FunnelRow key={s.index} lane={lane} station={s} />
            ))}
          </ol>
          <div className="flex flex-col gap-4">
            <WorstCallout lane={lane} />
            <OutcomeStrip lane={lane} />
          </div>
        </section>
      ))}
    </div>
  );
}

function FunnelRow({ lane, station: s }: { lane: ProcessLane; station: Station }) {
  const f = figures(lane, s);
  const n = lane.model.n || 1;
  const worst = f.rank === 1;
  const clean = (100 * Math.max(0, s.reached - s.exits)) / n;
  const lost = (100 * s.exits) / n;
  return (
    <li className="flex flex-col justify-center" style={{ height: ROW }} data-testid={`process-lane-${lane.id}-station-${s.index}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`shrink-0 typo-heading ${worst ? 'text-status-error' : 'text-foreground'}`}>{lane.stationName(s.keys)}</span>
        <span className="flex min-w-0 gap-2 truncate whitespace-nowrap typo-caption tabular-nums">
          {f.exitPct ? <span className="text-status-error">{`${f.exitPct}% ${PROTO.failed_short}`}</span> : null}
          {f.stumblePct ? <span className="text-status-warning">{`${f.stumblePct}%`}</span> : null}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <div className="flex-1" aria-hidden="true">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-secondary/60">
            <span className="bg-primary" style={{ width: `${clean}%` }} />
            {lost > 0 && <span className="bg-status-error" style={{ width: `${Math.max(1, lost)}%` }} />}
          </div>
          {/* Stumbles underline the bar: the share of everyone that hit friction here. */}
          <div className="mt-0.5 h-0.5 rounded-full bg-status-warning" style={{ width: `${(100 * s.friction) / n}%` }} />
        </div>
        <span className="w-12 text-right typo-data tabular-nums text-foreground">{f.reachedPct}%</span>
      </div>
    </li>
  );
}
