import { Trophy } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { CellAggregate } from '../../libs/evalAggregation';

type HeatBucket = 'excellent' | 'good' | 'fair' | 'weak' | 'poor';

// Static class bundles so Tailwind's JIT can detect every class at build time —
// an interpolated `bg-status-${x}` string is invisible to the v4 JIT and renders
// unstyled. Five intensity steps over the semantic success→warning→error tokens.
const HEAT_CLASSES: Record<HeatBucket, string> = {
  excellent: 'bg-status-success/25 text-status-success border-status-success/40',
  good:      'bg-status-success/12 text-status-success border-status-success/25',
  fair:      'bg-status-warning/15 text-status-warning border-status-warning/30',
  weak:      'bg-status-error/12 text-status-error border-status-error/25',
  poor:      'bg-status-error/25 text-status-error border-status-error/40',
};

function heatBucket(score: number): HeatBucket {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  if (score >= 20) return 'weak';
  return 'poor';
}

interface EvalHeatCellProps {
  cell: CellAggregate;
  /** Highest-scoring cell in the whole grid — gets a ring + trophy marker. */
  isBest: boolean;
}

/**
 * One version×model cell of the Eval matrix, rendered as a heat tile whose
 * background intensity tracks the composite score so the strongest combo reads
 * at a glance. Hover surfaces the per-dimension breakdown.
 */
export function EvalHeatCell({ cell, isBest }: EvalHeatCellProps) {
  const tip = `TA ${cell.avgToolAccuracy} · OQ ${cell.avgOutputQuality} · PC ${cell.avgProtocolCompliance} · n${cell.count}`;
  return (
    <Tooltip content={tip}>
      <div
        className={`relative inline-flex items-center justify-center min-w-[3rem] px-2.5 py-1.5 rounded-card border typo-heading font-bold tabular-nums ${HEAT_CLASSES[heatBucket(cell.compositeScore)]} ${isBest ? 'ring-1 ring-primary/50' : ''}`}
      >
        {isBest && <Trophy className="w-2.5 h-2.5 absolute -top-1 -right-1 text-primary" />}
        {cell.compositeScore}
      </div>
    </Tooltip>
  );
}
