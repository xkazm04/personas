import { useMemo } from 'react';
import type { PipelineTraceEntry } from '@/lib/execution/pipeline';
import { DollarSign, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Cost Accrual Overlay (SVG curve on the waterfall)
// ---------------------------------------------------------------------------

export function CostAccrualOverlay({
  entries,
  totalDurationMs,
  totalCostUsd,
  isSynthetic = false,
}: {
  entries: PipelineTraceEntry[];
  totalDurationMs: number;
  totalCostUsd: number;
  /** True when the entries came from `buildSyntheticTrace` (reconstructed
   *  proportional estimates, e.g. the "~95% during streaming" split below)
   *  rather than a captured trace — surfaces the same "Estimated" badge
   *  PipelineWaterfall shows on the waterfall itself, so the curve isn't
   *  mistaken for a real per-stage cost measurement. */
  isSynthetic?: boolean;
}) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;

  const points = useMemo(() => {
    if (totalCostUsd <= 0 || totalDurationMs <= 0) return [];

    const pts: Array<{ pct: number; costPct: number }> = [];
    let accrued = 0;

    pts.push({ pct: 0, costPct: 0 });

    for (const entry of entries) {
      const offsetMs = entry.start_ms;
      const endMs = offsetMs + (entry.duration_ms ?? 0);
      const startPct = (offsetMs / totalDurationMs) * 100;
      const endPct = (endMs / totalDurationMs) * 100;

      if (entry.span_type === 'stream_output') {
        pts.push({ pct: startPct, costPct: (accrued / totalCostUsd) * 100 });
        accrued += totalCostUsd * 0.95;
        pts.push({ pct: endPct, costPct: (accrued / totalCostUsd) * 100 });
      } else if (entry.span_type === 'finalize_status') {
        pts.push({ pct: startPct, costPct: (accrued / totalCostUsd) * 100 });
        accrued = totalCostUsd;
        pts.push({ pct: endPct, costPct: 100 });
      }
    }

    const lastPt = pts[pts.length - 1];
    if (pts.length > 0 && lastPt && lastPt.costPct < 100) {
      pts.push({ pct: 100, costPct: 100 });
    }

    return pts;
  }, [entries, totalDurationMs, totalCostUsd]);

  if (points.length < 2) return null;

  const svgW = 100;
  const svgH = 20;
  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.pct / 100) * svgW},${svgH - (p.costPct / 100) * svgH}`)
    .join(' ');
  const areaD = pathD + ` L${svgW},${svgH} L0,${svgH} Z`;

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2 mb-1">
        <DollarSign className="w-3 h-3 text-emerald-400" />
        <span className="typo-code text-foreground uppercase tracking-wider">
          {tx(e.cost_accrual, { cost: totalCostUsd.toFixed(4) })}
        </span>
        {isSynthetic && (
          <span
            className="flex items-center gap-1 typo-code text-status-warning uppercase tracking-wider"
            data-testid="cost-accrual-synthetic-badge"
          >
            <AlertCircle className="w-3 h-3" />
            {e.estimated_no_trace}
          </span>
        )}
      </div>
      <div className="h-5 bg-primary/5 rounded overflow-hidden">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          <path d={areaD} fill="rgba(16, 185, 129, 0.1)" />
          <path d={pathD} fill="none" stroke="rgba(16, 185, 129, 0.5)" strokeWidth="0.5" />
        </svg>
      </div>
    </div>
  );
}
