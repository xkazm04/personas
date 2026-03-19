import { useMemo } from 'react';
import type { PipelineTraceEntry } from '@/lib/execution/pipeline';
import { DollarSign } from 'lucide-react';

// ---------------------------------------------------------------------------
// Cost Accrual Overlay (SVG curve on the waterfall)
// ---------------------------------------------------------------------------

export function CostAccrualOverlay({
  entries,
  totalDurationMs,
  pipelineStartMs,
  totalCostUsd,
}: {
  entries: PipelineTraceEntry[];
  totalDurationMs: number;
  pipelineStartMs: number;
  totalCostUsd: number;
}) {
  if (totalCostUsd <= 0 || totalDurationMs <= 0) return null;

  // Build cost accrual points: cost accrues during stream_output and finalize_status
  const points = useMemo(() => {
    const pts: Array<{ pct: number; costPct: number }> = [];
    let accrued = 0;

    pts.push({ pct: 0, costPct: 0 });

    for (const entry of entries) {
      const offsetMs = entry.start_ms;
      const endMs = offsetMs + (entry.duration_ms ?? 0);
      const startPct = (offsetMs / totalDurationMs) * 100;
      const endPct = (endMs / totalDurationMs) * 100;

      if (entry.span_type === 'stream_output') {
        // Bulk of cost accrues here
        pts.push({ pct: startPct, costPct: (accrued / totalCostUsd) * 100 });
        accrued += totalCostUsd * 0.95; // ~95% of cost in streaming
        pts.push({ pct: endPct, costPct: (accrued / totalCostUsd) * 100 });
      } else if (entry.span_type === 'finalize_status') {
        pts.push({ pct: startPct, costPct: (accrued / totalCostUsd) * 100 });
        accrued = totalCostUsd;
        pts.push({ pct: endPct, costPct: 100 });
      }
    }

    // Ensure we end at 100%
    const lastPt = pts[pts.length - 1];
    if (pts.length > 0 && lastPt && lastPt.costPct < 100) {
      pts.push({ pct: 100, costPct: 100 });
    }

    return pts;
  }, [entries, totalDurationMs, pipelineStartMs, totalCostUsd]);

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
        <span className="typo-code text-muted-foreground/60 uppercase tracking-wider">
          Cost Accrual -- ${totalCostUsd.toFixed(4)}
        </span>
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
