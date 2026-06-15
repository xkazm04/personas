// Shared primitives for the Goal Acceptance prototype variants. Token-based
// (typo-*, status colors, semantic radii) so every variant reads as a sibling
// of the existing Goals surfaces. Hoisted here from variant 1 the moment a
// second variant needed the same piece (per the prototype skill's "hoist shared
// pieces mid-prototype" rule). i18n extraction is deferred to consolidation.
import { useState } from 'react';
import { Check, X, RotateCcw, Gauge, Send } from 'lucide-react';

import type { PendingKpi, PendingTeam } from './goalAcceptanceMock';
import { kpiPct } from './goalAcceptanceMock';

/** Color-mix helper — a translucent wash of a team/KPI accent. */
export function wash(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

/** Team avatar — monogram on the team's accent. The one symbol that ties a
 *  goal to its column at a glance. */
export function TeamMonogram({ team, size = 22 }: { team: PendingTeam; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold leading-none shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: wash(team.color, 22),
        color: team.color,
        border: `1px solid ${wash(team.color, 45)}`,
      }}
      title={team.name}
    >
      {team.monogram}
    </span>
  );
}

/** Column header for a team: monogram + name + completed count. */
export function TeamColumnHeader({ team, count }: { team: PendingTeam; count: number }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <TeamMonogram team={team} />
      <div className="min-w-0">
        <p className="typo-label text-foreground truncate leading-tight">{team.name}</p>
        <p className="typo-caption tabular-nums" style={{ color: team.color }}>
          {count} ready
        </p>
      </div>
    </div>
  );
}

/** A compact baseline→target gauge with the current value as a marker, tinted
 *  by track state. The signature KPI visual reused across the variants. */
export function KpiMiniGauge({ kpi, width = 150 }: { kpi: PendingKpi; width?: number }) {
  const pct = kpiPct(kpi);
  const tint = kpi.offTrack ? 'var(--destructive)' : 'var(--success)';
  return (
    <div style={{ width }}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="typo-caption tabular-nums" style={{ color: tint }}>
          {kpi.current}
          {kpi.unit}
        </span>
        <span className="typo-caption text-foreground/60 tabular-nums">
          → {kpi.target}
          {kpi.unit}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full overflow-hidden bg-primary/10">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: tint }}
        />
      </div>
    </div>
  );
}

/** KPI group header — the outcome a cluster of goals is bidding to move.
 *  `ready` is the count of completed goals waiting under it. */
export function KpiGroupHeader({
  kpi,
  ready,
  accent = 'var(--primary)',
}: {
  kpi: PendingKpi | null;
  ready: number;
  accent?: string;
}) {
  if (!kpi) {
    return (
      <div className="flex items-center gap-2">
        <span className="h-3 w-0.5 rounded-full bg-primary/40" />
        <span className="typo-caption uppercase tracking-[0.18em] text-foreground/70">
          Standalone
        </span>
        <span className="typo-caption text-foreground/50 tabular-nums">· {ready} ready</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="flex items-center gap-1.5">
        <Gauge className="w-3.5 h-3.5" style={{ color: accent }} />
        <span className="typo-label text-foreground">{kpi.name}</span>
      </span>
      {kpi.offTrack && (
        <span className="typo-caption px-1.5 py-0.5 rounded-full text-[var(--destructive)] border border-[var(--destructive)]/30 bg-[var(--destructive)]/5">
          off track
        </span>
      )}
      <KpiMiniGauge kpi={kpi} width={130} />
      <span className="typo-caption text-foreground/55 tabular-nums">{ready} ready</span>
    </div>
  );
}

/**
 * Accept / reject controls with an inline reject-comment box. Accept is the
 * primary affordance; reject opens a comment field (rejection always carries a
 * reason — it becomes the feedback the team reworks against).
 */
export function AcceptRejectControls({
  onAccept,
  onReject,
  size = 'md',
}: {
  onAccept: () => void;
  onReject: (comment: string) => void;
  size?: 'sm' | 'md';
}) {
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const pad = size === 'sm' ? 'px-2 py-1' : 'px-2.5 py-1.5';

  if (rejecting) {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        <textarea
          autoFocus
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Why is this not acceptable? (sent back to the team)"
          rows={2}
          className="w-full px-2 py-1.5 typo-caption bg-secondary/40 border border-[var(--destructive)]/25 rounded-input text-foreground placeholder:text-foreground/40 focus-ring resize-none"
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!comment.trim()}
            onClick={() => onReject(comment.trim())}
            className="inline-flex items-center gap-1 typo-caption rounded-interactive px-2 py-1 text-[var(--destructive)] border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 hover:bg-[var(--destructive)]/20 transition-colors disabled:opacity-40"
          >
            <Send className="w-3 h-3" /> Send back
          </button>
          <button
            type="button"
            onClick={() => { setRejecting(false); setComment(''); }}
            className="typo-caption rounded-interactive px-2 py-1 text-foreground/60 hover:text-foreground hover:bg-primary/10 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onAccept}
        className={`inline-flex items-center gap-1 typo-caption rounded-interactive ${pad} text-[var(--success)] border border-[var(--success)]/30 bg-[var(--success)]/10 hover:bg-[var(--success)]/20 transition-colors`}
      >
        <Check className="w-3.5 h-3.5" /> Accept
      </button>
      <button
        type="button"
        onClick={() => setRejecting(true)}
        aria-label="Reject with comment"
        title="Send back with a comment"
        className={`inline-flex items-center gap-1 typo-caption rounded-interactive ${pad} text-foreground/60 border border-primary/15 hover:text-[var(--destructive)] hover:border-[var(--destructive)]/30 transition-colors`}
      >
        <RotateCcw className="w-3.5 h-3.5" /> Send back
      </button>
    </div>
  );
}

/** Tiny dismiss/empty marker for an empty team cell in the strict matrix. */
export function EmptyCell() {
  return (
    <span className="flex items-center justify-center text-foreground/15 select-none">
      <X className="w-3 h-3" strokeWidth={1.5} />
    </span>
  );
}
