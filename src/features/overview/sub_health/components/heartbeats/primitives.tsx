import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { HealthGrade, PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';
import { GRADE_THEME, gradeFromScore, subScores, segLabels } from './model';

// ---------------------------------------------------------------------------
// Shared heartbeat primitives — extractable building blocks for the ledger.
// ---------------------------------------------------------------------------

export function GradeDot({ grade, className = '' }: { grade: HealthGrade; className?: string }) {
  const th = GRADE_THEME[grade];
  return <span className={`shrink-0 w-2 h-2 rounded-full ${th.dot} ring-2 ${th.ring} ${className}`} />;
}

/** A single thin composite heartbeat bar filled to `score`, tinted by grade,
 *  with faint 50/80 grade-threshold ticks so the fill reads against the scale. */
export function CompositeHealthBar({ score, grade, height = 'h-1.5' }: { score: number; grade: HealthGrade; height?: string }) {
  const th = GRADE_THEME[grade];
  const pct = Math.max(2, Math.min(100, score));
  return (
    <div className={`relative w-full ${height} rounded-full ${th.track} overflow-hidden`}>
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${th.bar} transition-[width] duration-500 ease-out`}
        style={{ width: `${pct}%`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25)' }}
      />
      <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/10" />
      <span className="absolute inset-y-0 left-[80%] w-px bg-foreground/10" />
    </div>
  );
}

/** Four-segment diagnostic bar — each segment is one sub-score (success /
 *  healing / stability / budget), independently colored. Reads as a vitals strip. */
export function SegmentedVitalsBar({ signal, height = 'h-1.5' }: { signal: PersonaHealthSignal; height?: string }) {
  const { t } = useTranslation();
  const labels = segLabels(t);
  const segs = subScores(signal);
  return (
    <div className="flex items-center gap-1 w-full">
      {segs.map(seg => {
        const th = GRADE_THEME[gradeFromScore(seg.score)];
        const pct = Math.max(4, Math.min(100, seg.score));
        return (
          <div
            key={seg.key}
            className={`relative flex-1 ${height} rounded-full ${th.track} overflow-hidden`}
            title={`${labels[seg.key]}: ${seg.detail}`}
          >
            <div className={`absolute inset-y-0 left-0 rounded-full ${th.bar} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
          </div>
        );
      })}
    </div>
  );
}

const TREND_ICON: Record<PersonaHealthSignal['failureTrend'], LucideIcon> = {
  improving: TrendingUp, stable: Minus, degrading: TrendingDown,
};
const TREND_COLOR: Record<PersonaHealthSignal['failureTrend'], string> = {
  improving: 'text-status-success', stable: 'text-zinc-400', degrading: 'text-status-error',
};

export function TrendBadge({ trend, label }: { trend: PersonaHealthSignal['failureTrend']; label?: string }) {
  const Icon = TREND_ICON[trend];
  return (
    <span className={`inline-flex items-center gap-1 typo-caption ${TREND_COLOR[trend]}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

/** A compact icon + tabular value, used for inline row stats. */
export function MiniStat({ icon: Icon, value, tone = 'text-foreground', title }: {
  icon: LucideIcon; value: ReactNode; tone?: string; title?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 typo-data text-foreground" title={title}>
      <Icon className={`w-3 h-3 shrink-0 ${tone}`} />
      <span className="tabular-nums">{value}</span>
    </span>
  );
}
