import type { Station } from './engine/spine';
import { pct } from './labels';
import { PROTO, type LaneProvenance, type ProcessLane } from './lanes';

/** Shared by every side-by-side variant: the lane's identity, its headline and its endings. */

const PROVENANCE_TONE: Record<LaneProvenance, string> = {
  real: 'border-primary/30 text-primary',
  projected: 'border-status-info/40 text-status-info',
  sample: 'border-status-warning/40 text-status-warning',
};

export function ProvenanceChip({ provenance }: { provenance: LaneProvenance }) {
  return (
    <span className={`rounded-pill border px-2 py-0.5 typo-caption uppercase tracking-wider ${PROVENANCE_TONE[provenance]}`}>
      {PROTO.provenance[provenance]}
    </span>
  );
}

/** Title, count, and the one number a lane is judged by: the share that reached its good ending. */
export function LaneHeadline({ lane, compact = false }: { lane: ProcessLane; compact?: boolean }) {
  const { n } = lane.model;
  return (
    <header>
      <div className="flex items-center justify-between gap-3">
        <h2 className="typo-heading-lg text-foreground truncate">{lane.title}</h2>
        {!compact && <ProvenanceChip provenance={lane.provenance} />}
      </div>
      <div className={`flex items-baseline gap-3 ${compact ? 'mt-1' : 'mt-2'}`}>
        <span className={`${compact ? 'typo-data-lg' : 'typo-hero'} shrink-0 tabular-nums text-foreground`}>{pct(lane.good.n, n)}%</span>
        <span className="min-w-0 truncate typo-body text-foreground">{lane.good.label}</span>
      </div>
      <p className="mt-1 flex items-center gap-3 typo-caption tabular-nums">
        {n} {lane.unit}
        {compact && <ProvenanceChip provenance={lane.provenance} />}
      </p>
    </header>
  );
}

/** Every instance counted once, by how it ended. */
export function OutcomeStrip({ lane, legend = 3, stacked = false }: { lane: ProcessLane; legend?: number; stacked?: boolean }) {
  const { n } = lane.model;
  const rows = lane.outcomes.filter((o) => o.n > 0);
  const top = [...rows].sort((a, b) => b.n - a.n).slice(0, legend);
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-secondary/60" aria-hidden="true">
        {rows.map((o) => (
          <span key={o.key} className={o.tone} style={{ width: `${(100 * o.n) / (n || 1)}%` }} />
        ))}
      </div>
      <ul className={`mt-2 flex gap-x-4 gap-y-1 ${stacked ? 'flex-col' : 'flex-wrap'}`}>
        {top.map((o) => (
          <li key={o.key} className="flex items-center gap-1.5 whitespace-nowrap typo-caption text-foreground">
            <span className={`h-2 w-2 rounded-full ${o.tone}`} />
            <span className="truncate">{o.label}</span>
            <span className={`tabular-nums ${stacked ? 'ml-auto' : ''}`}>{pct(o.n, n)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The one key every variant shares: what the three colours on a station mean. */
export function LaneKey() {
  const items: [string, string][] = [
    ['bg-primary', PROTO.key_reached],
    ['bg-status-error', PROTO.key_failed],
    ['bg-status-warning', PROTO.key_stumbled],
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
      {items.map(([tone, label]) => (
        <li key={tone} className="flex items-center gap-2 whitespace-nowrap typo-caption text-foreground">
          <span className={`h-2 w-4 rounded-full ${tone}`} />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** The station with the most failed endings, said in one line. */
export function WorstCallout({ lane }: { lane: ProcessLane }) {
  const q = lane.model.worst[0];
  const s: Station | undefined = q != null ? lane.model.stations[q] : undefined;
  if (!s) {
    return <p className="rounded-interactive border border-primary/10 px-3 py-2 typo-body">{PROTO.none}</p>;
  }
  const share = s.reached ? pct(s.exits || s.friction, s.reached) : 0;
  return (
    <div className="rounded-interactive border border-status-error/30 bg-status-error/10 px-3 py-2">
      <p className="typo-caption uppercase tracking-wider text-status-error">{PROTO.most_failures}</p>
      <p className="mt-0.5 flex items-baseline justify-between gap-3">
        <span className="typo-heading text-foreground truncate">{lane.stationName(s.keys)}</span>
        <span className="typo-data tabular-nums text-status-error">{share}%</span>
      </p>
    </div>
  );
}
