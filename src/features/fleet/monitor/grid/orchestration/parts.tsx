// Shared pieces the Orchestration ledger renders — hoisted so a tweak lands
// once.
//
//   VerdictChip     what the next tick does with the persona, as a status chip
//   LaneChip        the lane it would take (arrivals / advance / …)
//   PersonaIdentity icon + name + App Master mark, one line
//   BudgetBand      the tick's budget line: starts, waiting, pacing hold
//
// The rank mark and the ↑/↓ reorder buttons left with the dispatch-order
// editor (the ledger is read-only; the board queue replaces order editing).

import { Crown, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { StatusBadge, type StatusVariant } from '@/features/shared/components/display/StatusBadge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DispatchPreviewRow } from '@/lib/bindings/DispatchPreviewRow';
import type { DispatchPreviewView } from '@/lib/bindings/DispatchPreviewView';

type Orch = ReturnType<typeof useTranslation>['t']['monitor'];

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
    case 'disabled':
      return s.orch_verdict_disabled;
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
  const s = t.monitor;
  const chip = (
    <StatusBadge size={size} variant={verdictVariant(row.verdict)}>
      {verdictLabel(s, tx, row.verdict)}
    </StatusBadge>
  );
  // The loop's own sentence for a refusal, so the operator reads the rung; for
  // a switched-off persona, what "off" means.
  if (row.verdict.kind === 'refused') return <Tooltip content={row.verdict.reason}>{chip}</Tooltip>;
  if (row.verdict.kind === 'disabled') return <Tooltip content={s.orch_disabled_hint}>{chip}</Tooltip>;
  return chip;
}

export function LaneChip({ lane }: { lane: string | null }) {
  const { t } = useTranslation();
  if (!lane) return null;
  return (
    <StatusBadge size="sm" accent={lane === 'decide' ? 'violet' : 'cyan'}>
      {laneLabel(t.monitor, lane)}
    </StatusBadge>
  );
}

export function PersonaIdentity({ row, dense = false }: { row: DispatchPreviewRow; dense?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <PersonaIcon icon={row.personaIcon} color={row.personaColor} name={row.personaName} display="pop" frameSize={dense ? 'sm' : 'md'} />
      <span className={`truncate ${dense ? 'typo-caption' : 'typo-title'} text-foreground`}>{row.personaName}</span>
      {row.appMaster && (
        <Tooltip content={t.monitor.orch_app_master}>
          <Crown className="h-3.5 w-3.5 flex-shrink-0 text-status-warning" aria-label={t.monitor.orch_app_master} />
        </Tooltip>
      )}
      {row.wakePending && (
        <Tooltip content={t.monitor.orch_wake_pending}>
          <Zap className="h-3.5 w-3.5 flex-shrink-0 text-status-info" aria-label={t.monitor.orch_wake_pending} />
        </Tooltip>
      )}
    </span>
  );
}

export function BudgetBand({ view }: { view: DispatchPreviewView }) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
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
        <span className="typo-title tabular-nums">{view.preview.budget}</span> {s.orch_budget_starts}
      </span>
      <span>
        <span className="typo-title tabular-nums">{view.preview.wouldStart}</span> {s.orch_would_start}
      </span>
      <span>
        <span className="typo-title tabular-nums">{view.preview.waiting}</span> {s.orch_waiting}
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
