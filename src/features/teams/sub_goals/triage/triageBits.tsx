// Presentational pieces of the goal-triage surface — status chip/dot, the KPI
// gauge, the modal header band, and the empty state.
//
// Semantic tokens only: `typo-*` for every text tier, `--status-*`/`--primary`
// for ink, `rounded-card`/`rounded-interactive` for radii.
import type { LucideIcon } from 'lucide-react';
import { Target } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { goalStatusLabel, goalStatusMeta } from '../goalStatus';
import { kpiFill, type GoalKpi, type GoalRow } from './triageModel';

const wash = (color: string, pct: number): string => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** Status pill — the canonical icon on the status tint. */
export function GoalStatusChip({ row, compact = false }: { row: GoalRow; compact?: boolean }) {
  const { t } = useTranslation();
  const Icon = goalStatusMeta(row.status).icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-interactive shrink-0 ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'} typo-label`}
      style={{ color: row.tint, background: wash(row.tint, 14), border: `1px solid ${wash(row.tint, 32)}` }}
    >
      <Icon className="w-3 h-3" />
      {goalStatusLabel(t.plugins.dev_lifecycle, row.status)}
    </span>
  );
}

/** A solid dot in the status tint — the compact-row identity mark. */
export function GoalStatusDot({ row }: { row: GoalRow }) {
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: row.tint }} aria-hidden />;
}

/** Current→target reading with a filled track. */
export function KpiGauge({ kpi, width }: { kpi: GoalKpi; width?: number }) {
  const pct = kpiFill(kpi);
  const tint = kpi.offTrack ? 'var(--status-warning)' : 'var(--status-success)';
  return (
    <div style={width ? { width } : undefined} className={width ? undefined : 'w-full'}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="typo-caption truncate" style={{ color: tint }}>{kpi.name}</span>
        <span className="typo-caption text-foreground/70 tabular-nums shrink-0">
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

/** The modal's title band — icon, project name, and the "N need you" counter
 *  that is the whole reason the surface exists. */
export function TriageHeaderBand({ icon: Icon, title, subject, awaiting, children }: {
  icon: LucideIcon;
  title: string;
  subject: string;
  awaiting: number;
  children?: React.ReactNode;
}) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04] flex-shrink-0">
      <Icon className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
      <span className="typo-title truncate">{title}</span>
      <span className="typo-caption text-foreground/70 truncate">· {subject}</span>
      {awaiting > 0 && (
        <span className="typo-label text-primary tabular-nums shrink-0 px-1.5 py-0.5 rounded-interactive bg-primary/12 border border-primary/25">
          {tx(awaiting === 1 ? dl.triage_needs_you_one : dl.triage_needs_you_other, { count: awaiting })}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2 shrink-0">{children}</span>
    </div>
  );
}

/** Whole-surface empty copy. */
export function TriageEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1 px-6 text-center py-12">
      <Target className="w-7 h-7 text-foreground/15 mb-1" aria-hidden />
      <p className="typo-title text-foreground">{title}</p>
      <p className="typo-caption text-foreground/70 max-w-[42ch]">{body}</p>
    </div>
  );
}
