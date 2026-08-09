// One ember cell of the Trace matrix — the /prototype fork leaf. Pure
// presentational: dot radius ∝ √invokes, fill opacity ∝ heat, hollow ring for
// adopted-but-cold, faint dot for absent. Skill accent arrives via prop and is
// applied through inline style (design tokens carry the chrome; the accent is
// data, not theme).
import { memo } from 'react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import type { TraceCell } from './traceTypes';

const BOX = 30;

/** Dot radius in px from invoke volume (sqrt-dampened, 5..13). */
function radiusOf(invokes30d: number): number {
  return Math.min(13, 5 + 2 * Math.sqrt(invokes30d));
}

export interface TraceEmberCellProps {
  cell: TraceCell;
  /** Skill accent (hex) — falls back to the primary token via currentColor. */
  accent: string | null;
  onClick: () => void;
}

/** Memoized leaf — the matrix renders skills × projects of these and only a
 *  model refresh changes their inputs (onClick identity churn aside, the
 *  cell/accent props are stable per fetch). */
export const TraceEmberCell = memo(TraceEmberCellImpl);

function TraceEmberCellImpl({ cell, accent, onClick }: TraceEmberCellProps) {
  const { t, tx } = useTranslation();
  const c = BOX / 2;

  const body = (
    <svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden className="block">
      {cell.tier === 'absent' && (
        <circle cx={c} cy={c} r={2} className="fill-foreground/15" />
      )}
      {cell.tier === 'cold' && (
        <circle cx={c} cy={c} r={6} fill="none" strokeWidth={1.5}
          className="stroke-foreground/30" strokeDasharray="2.5 2.5" />
      )}
      {cell.tier !== 'absent' && cell.tier !== 'cold' && (
        <circle
          cx={c} cy={c} r={radiusOf(cell.invokes30d)}
          style={accent ? { fill: accent, fillOpacity: 0.25 + 0.65 * cell.heat } : undefined}
          className={accent ? undefined : 'fill-primary'}
        />
      )}
    </svg>
  );

  const tierLabel = {
    hot: t.plugins.dev_tools.trace_tier_hot,
    warm: t.plugins.dev_tools.trace_tier_warm,
    cool: t.plugins.dev_tools.trace_tier_cool,
    cold: t.plugins.dev_tools.trace_tier_cold,
    absent: t.plugins.dev_tools.trace_tier_absent,
  }[cell.tier];

  const tooltip = [
    tierLabel,
    cell.adopted ? tx(t.plugins.dev_tools.trace_cell_invokes, { count: cell.invokes30d }) : null,
    cell.installedVersion != null ? `v${cell.installedVersion}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Tooltip content={tooltip}>
      <button
        type="button"
        onClick={onClick}
        aria-label={tierLabel}
        className="flex items-center justify-center rounded-interactive hover:bg-secondary/60 transition-colors"
      >
        {body}
      </button>
    </Tooltip>
  );
}
