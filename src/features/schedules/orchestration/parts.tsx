// Shared pieces every Orchestration variant renders — hoisted from the start
// so a tweak lands once (the prototype skill's "hoist mid-prototype" rule).
//
//   VerdictChip     what the next tick does with the persona, as a status chip
//   LaneChip        the lane it would take (arrivals / advance / …)
//   RankMark        the operator's rank, or "by need" when unranked
//   PersonaIdentity icon + name + App Master mark, one line
//   BudgetBand      the tick's budget line: starts, waiting, pacing hold
//   ReorderButtons  the keyboard alternative to dragging (↑ / ↓)

import { ChevronDown, ChevronUp, Crown, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { StatusBadge, type StatusVariant } from '@/features/shared/components/display/StatusBadge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DispatchPreviewRow } from '@/lib/bindings/DispatchPreviewRow';
import type { DispatchPreviewView } from '@/lib/bindings/DispatchPreviewView';

type Orch = ReturnType<typeof useTranslation>['t']['schedules'];

export function verdictVariant(v: DispatchPreviewRow['verdict']): StatusVariant {
  switch (v.kind) {
    case 'dispatch':
      return 'success';
    case 'waits_for_slot':
      return 'warning';
    case 'refused':
      return 'error';
    case 'maintenance':
      return 'processing';
    default:
      return 'neutral';
  }
}

export function refusalLabel(s: Orch, refusal: string): string {
  switch (refusal) {
    case 'in_flight':
      return s.orch_refusal_in_flight;
    case 'interval_floor':
      return s.orch_refusal_interval_floor;
    case 'quiet_hours':
      return s.orch_refusal_quiet_hours;
    case 'daily_cap_reached':
      return s.orch_refusal_daily_cap;
    case 'budget_exhausted':
      return s.orch_refusal_budget;
    case 'concurrency_cap':
      return s.orch_refusal_concurrency;
    default:
      return refusal;
  }
}

export function verdictLabel(s: Orch, tx: ReturnType<typeof useTranslation>['tx'], v: DispatchPreviewRow['verdict']): string {
  switch (v.kind) {
    case 'dispatch':
      return tx(s.orch_verdict_dispatch, { slot: v.slot });
    case 'waits_for_slot':
      return s.orch_verdict_waits;
    case 'maintenance':
      return s.orch_verdict_maintenance;
    case 'idle':
      return s.orch_verdict_idle;
    case 'refused':
      return refusalLabel(s, v.refusal);
  }
}

export function laneLabel(s: Orch, lane: string): string {
  switch (lane) {
    case 'arrivals':
      return s.orch_lane_arrivals;
    case 'advance':
      return s.orch_lane_advance;
    case 'improve':
      return s.orch_lane_improve;
    case 'decide':
      return s.orch_lane_decide;
    case 'maintenance':
      return s.orch_lane_maintenance;
    default:
      return lane;
  }
}

export function VerdictChip({ row, size = 'sm' }: { row: DispatchPreviewRow; size?: 'sm' | 'md' }) {
  const { t, tx } = useTranslation();
  const s = t.schedules;
  const chip = (
    <StatusBadge size={size} variant={verdictVariant(row.verdict)}>
      {verdictLabel(s, tx, row.verdict)}
    </StatusBadge>
  );
  // The loop's own sentence for a refusal, so the operator reads the rung.
  return row.verdict.kind === 'refused' ? <Tooltip content={row.verdict.reason}>{chip}</Tooltip> : chip;
}

export function LaneChip({ lane }: { lane: string | null }) {
  const { t } = useTranslation();
  if (!lane) return null;
  return (
    <StatusBadge size="sm" accent={lane === 'decide' ? 'violet' : 'cyan'}>
      {laneLabel(t.schedules, lane)}
    </StatusBadge>
  );
}

export function RankMark({ rank, position, big = false }: { rank: number | null; position: number; big?: boolean }) {
  const { t, tx } = useTranslation();
  const cls = big ? 'typo-data-lg tabular-nums' : 'typo-title tabular-nums';
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={`${cls} ${rank == null ? 'text-foreground opacity-60' : 'text-foreground'}`}>{position}</span>
      {rank == null && <span className="typo-label text-foreground opacity-60">{t.schedules.orch_by_need}</span>}
      {rank != null && rank !== position && (
        <span className="typo-label text-foreground opacity-60">{tx(t.schedules.orch_rank_was, { rank })}</span>
      )}
    </span>
  );
}

export function PersonaIdentity({ row, dense = false }: { row: DispatchPreviewRow; dense?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <PersonaIcon icon={row.personaIcon} color={row.personaColor} name={row.personaName} display="pop" frameSize={dense ? 'sm' : 'md'} />
      <span className={`truncate ${dense ? 'typo-caption' : 'typo-title'} text-foreground`}>{row.personaName}</span>
      {row.appMaster && (
        <Tooltip content={t.schedules.orch_app_master}>
          <Crown className="h-3.5 w-3.5 flex-shrink-0 text-status-warning" aria-label={t.schedules.orch_app_master} />
        </Tooltip>
      )}
      {row.wakePending && (
        <Tooltip content={t.schedules.orch_wake_pending}>
          <Zap className="h-3.5 w-3.5 flex-shrink-0 text-status-info" aria-label={t.schedules.orch_wake_pending} />
        </Tooltip>
      )}
    </span>
  );
}

export function BudgetBand({ view }: { view: DispatchPreviewView }) {
  const { t, tx } = useTranslation();
  const s = t.schedules;
  const p = view.pacing;
  const hold = (() => {
    switch (p.hold) {
      case 'ahead_of_pace':
        return s.orch_hold_ahead;
      case 'five_hour_full':
        return s.orch_hold_five_hour;
      case 'memory_full':
        return s.orch_hold_memory;
      default:
        return null;
    }
  })();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 typo-caption text-foreground" data-testid="orchestration-budget">
      {!view.enabled && (
        <StatusBadge size="sm" variant="warning">
          {s.orch_autopilot_off}
        </StatusBadge>
      )}
      <span>
        <span className="typo-title text-foreground tabular-nums">{view.preview.budget}</span> {s.orch_budget_starts}
      </span>
      <span>
        <span className="typo-title text-foreground tabular-nums">{view.preview.wouldStart}</span> {s.orch_would_start}
      </span>
      <span>
        <span className="typo-title text-foreground tabular-nums">{view.preview.waiting}</span> {s.orch_waiting}
      </span>
      <span>{tx(s.orch_running, { running: view.headroom.running, cap: view.headroom.cap })}</span>
      {hold && (
        <StatusBadge size="sm" variant="warning">
          {hold}
        </StatusBadge>
      )}
    </div>
  );
}

export function ReorderButtons({
  id, first, last, onMove,
}: { id: string; first: boolean; last: boolean; onMove: (id: string, delta: -1 | 1) => void }) {
  const { t } = useTranslation();
  const btn = 'focus-ring rounded-interactive p-0.5 text-foreground opacity-60 hover:opacity-100 disabled:is-disabled';
  return (
    <span className="inline-flex flex-col">
      <button type="button" className={btn} disabled={first} onClick={() => onMove(id, -1)} aria-label={t.schedules.orch_move_up}>
        <ChevronUp className="h-3 w-3" aria-hidden />
      </button>
      <button type="button" className={btn} disabled={last} onClick={() => onMove(id, 1)} aria-label={t.schedules.orch_move_down}>
        <ChevronDown className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}
