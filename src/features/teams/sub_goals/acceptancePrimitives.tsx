// Shared primitives for the Goal Acceptance prototype variants. Token-based
// (typo-*, status colors, semantic radii) so every variant reads as a sibling
// of the existing Goals surfaces. Hoisted here from variant 1 the moment a
// second variant needed the same piece (per the prototype skill's "hoist shared
// pieces mid-prototype" rule). i18n extraction is deferred to consolidation.
import { useState } from 'react';
import { Check, RotateCcw, Send } from 'lucide-react';

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
        <span className="typo-caption text-muted-foreground tabular-nums">
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
          className="w-full px-2 py-1.5 typo-caption bg-secondary/50 rounded-input text-foreground placeholder:text-muted-foreground focus-ring resize-none"
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!comment.trim()}
            onClick={() => onReject(comment.trim())}
            className="inline-flex items-center gap-1 typo-caption rounded-interactive px-2 py-1 text-[var(--destructive)] bg-[var(--destructive)]/15 hover:bg-[var(--destructive)]/25 transition-colors disabled:opacity-40"
          >
            <Send className="w-3 h-3" /> Send back
          </button>
          <button
            type="button"
            onClick={() => { setRejecting(false); setComment(''); }}
            className="typo-caption rounded-interactive px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
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
        className={`inline-flex items-center gap-1 typo-caption rounded-interactive ${pad} text-[var(--success)] bg-[var(--success)]/15 hover:bg-[var(--success)]/25 transition-colors`}
      >
        <Check className="w-3.5 h-3.5" /> Accept
      </button>
      <button
        type="button"
        onClick={() => setRejecting(true)}
        aria-label="Reject with comment"
        title="Send back with a comment"
        className={`inline-flex items-center gap-1 typo-caption rounded-interactive ${pad} text-muted-foreground bg-primary/10 hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/15 transition-colors`}
      >
        <RotateCcw className="w-3.5 h-3.5" /> Send back
      </button>
    </div>
  );
}

/**
 * Thin KPI sub-group divider — a hairline rule carrying a small label, the
 * off-track state, a count, and an inline current→target. The compact,
 * border-free replacement for the boxed KPI section header, used when goals are
 * grouped by PROJECT first and KPIs become sub-headers within each project.
 */
export function KpiDivider({ kpi, count }: { kpi: PendingKpi | null; count: number }) {
  const tint = kpi ? (kpi.offTrack ? 'var(--destructive)' : 'var(--success)') : 'var(--muted-foreground)';
  return (
    <div className="flex items-center gap-2.5 pt-3 pb-1.5">
      {/* typo-label = 12px uppercase tracked — reads cleanly as a sub-divider
          marker, one tier below the project section-title above it. */}
      <span className="typo-label" style={{ color: tint }}>{kpi ? kpi.name : 'Standalone'}</span>
      {kpi?.offTrack && <span className="typo-label text-[var(--destructive)]">off track</span>}
      {kpi && (
        <span className="typo-caption text-muted-foreground tabular-nums">
          {kpi.current}{kpi.unit} → {kpi.target}{kpi.unit}
        </span>
      )}
      <span className="h-px flex-1 bg-primary/10" />
      <span className="typo-caption text-muted-foreground tabular-nums">{count}</span>
    </div>
  );
}

/** Shown when the acceptance queue is empty — shared across variants. */
export function EmptyQueue() {
  return (
    <div className="py-12 text-center">
      <p className="typo-title text-foreground">Nothing waiting on you</p>
      <p className="typo-body text-muted-foreground mt-1">Completed goals appear here for your acceptance.</p>
    </div>
  );
}
