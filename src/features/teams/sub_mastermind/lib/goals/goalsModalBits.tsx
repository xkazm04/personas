// Presentational pieces shared by the Goals-modal variants. Hoisted here as
// soon as a second variant needed the same structure (per the prototype skill's
// "hoist shared pieces mid-prototype" rule) — a status chip, the KPI gauge, the
// modal's header band and the per-lane empty state read the same in all three,
// only the arrangement around them differs.
//
// Semantic tokens only: `typo-*` for every text tier, `--status-*`/`--primary`
// for ink, `rounded-card`/`rounded-interactive` for radii.
import type { LucideIcon } from 'lucide-react';
import { Target } from 'lucide-react';

import { goalStatusMeta } from '@/features/teams/sub_goals/goalStatus';
import { mix } from '../ink';
import type { KpiListItem } from '../KpiListPopover';
import { kpiFill, type GoalRow } from './goalsModalModel';

const STATUS_COPY: Record<GoalRow['status'], string> = {
  open: 'Open',
  'in-progress': 'In progress',
  awaiting_acceptance: 'Needs you',
  blocked: 'Blocked',
  done: 'Done',
};

/** Status pill — the canonical icon on the canvas-native tint. */
export function GoalStatusChip({ row, compact = false }: { row: GoalRow; compact?: boolean }) {
  const Icon = goalStatusMeta(row.status).icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-interactive shrink-0 ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'} typo-label`}
      style={{ color: row.tint, background: mix(row.tint, 14, 'transparent'), border: `1px solid ${mix(row.tint, 32, 'transparent')}` }}
    >
      <Icon className="w-3 h-3" />
      {STATUS_COPY[row.status]}
    </span>
  );
}

/** A small solid dot in the status tint — the list-rail identity mark. */
export function GoalStatusDot({ row }: { row: GoalRow }) {
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: row.tint }} aria-hidden />;
}

/** Baseline→target reading with a filled track. The one KPI visual reused
 *  across all three variants (the acceptance queue's KpiMiniGauge, retuned for
 *  the canvas's `KpiListItem` shape). */
export function KpiGauge({ kpi, width }: { kpi: KpiListItem; width?: number }) {
  const pct = kpiFill(kpi);
  const met = kpi.status === 'met' || kpi.status === 'ok';
  const tint = met ? 'var(--status-success)' : kpi.status === 'crit' ? 'var(--status-error)' : 'var(--status-warning)';
  return (
    <div style={width ? { width } : undefined} className={width ? undefined : 'w-full'}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="typo-caption truncate" style={{ color: tint }}>{kpi.name}</span>
        <span className="typo-caption text-muted-foreground tabular-nums shrink-0">
          {kpi.current ?? '—'} → {kpi.target}{kpi.unit}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full overflow-hidden bg-primary/10">
        {/* No current reading = genuinely unknown; an empty track beats a
            fabricated 0%-filled bar. */}
        {pct != null && <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: tint }} />}
      </div>
    </div>
  );
}

/** Inline KPI tag for dense rows — name only, tinted, no track. */
export function KpiTag({ kpi }: { kpi: KpiListItem }) {
  return (
    <span className="inline-flex items-center gap-1 typo-caption text-muted-foreground min-w-0">
      <Target className="w-3 h-3 shrink-0" aria-hidden />
      <span className="truncate">{kpi.name}</span>
    </span>
  );
}

/** The modal's title band — icon, project name, and a trailing "N need you"
 *  counter that is the whole reason the surface exists. */
export function GoalsHeaderBand({ icon: Icon, title, projectName, awaiting, children }: {
  icon: LucideIcon;
  title: string;
  projectName: string;
  awaiting: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04] flex-shrink-0">
      <Icon className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
      <span className="typo-title truncate">{title}</span>
      <span className="typo-caption text-foreground/45 truncate">· {projectName}</span>
      {awaiting > 0 && (
        <span className="typo-label text-primary tabular-nums shrink-0 px-1.5 py-0.5 rounded-interactive bg-primary/12 border border-primary/25">
          {awaiting} need{awaiting === 1 ? 's' : ''} you
        </span>
      )}
      <span className="ml-auto flex items-center gap-2 shrink-0">{children}</span>
    </div>
  );
}

/** Per-lane / whole-modal empty copy. */
export function GoalsEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1 px-6 text-center">
      <Target className="w-7 h-7 text-foreground/15 mb-1" aria-hidden />
      <p className="typo-title text-foreground/70">{title}</p>
      <p className="typo-caption text-muted-foreground max-w-[34ch]">{body}</p>
    </div>
  );
}
