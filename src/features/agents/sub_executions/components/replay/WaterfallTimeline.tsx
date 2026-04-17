import { useMemo } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import type { UnifiedTrace, UnifiedSpan, PipelineStage } from '@/lib/execution/pipeline';
import { PIPELINE_STAGES, isPipelineStage } from '@/lib/execution/pipeline';
import { Clock, DollarSign, Zap, AlertCircle } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';
import { STAGE_COLORS } from '../../libs/waterfallHelpers';
import { useTranslation } from '@/i18n/useTranslation';

// Cost Accrual Overlay (SVG curve on the waterfall)

export function CostAccrualOverlay({
  entries,
  totalDurationMs,
  totalCostUsd,
}: {
  entries: UnifiedSpan[];
  totalDurationMs: number;
  totalCostUsd: number;
}) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  if (totalCostUsd <= 0 || totalDurationMs <= 0) return null;

  const points = useMemo(() => {
    const pts: Array<{ pct: number; costPct: number }> = [];
    let accrued = 0;

    pts.push({ pct: 0, costPct: 0 });

    for (const entry of entries) {
      if (!isPipelineStage(entry.span_type)) continue;
      const startPct = (entry.start_ms / totalDurationMs) * 100;
      const endMs = entry.start_ms + (entry.duration_ms ?? 0);
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
        <span className="typo-code text-muted-foreground/60 uppercase tracking-wider">
          {tx(e.cost_accrual, { cost: totalCostUsd.toFixed(4) })}
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

// Summary row

export function PipelineSummary({ trace, execution }: { trace: UnifiedTrace; execution: PersonaExecution }) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const totalMs = trace.completedAt ? trace.completedAt - trace.startedAt : 0;
  const stageSpans = trace.spans.filter((s) => isPipelineStage(s.span_type));
  const stagesHit = stageSpans.length;
  const errors = stageSpans.filter(s => s.error).length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 3xl:gap-4 4xl:gap-5">
      <div className="rounded-card border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" /> {e.total_duration}
        </div>
        <div className="typo-code text-foreground/90">{formatDuration(totalMs)}</div>
      </div>
      <div className="rounded-card border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <DollarSign className="w-2.5 h-2.5" /> {e.cost}
        </div>
        <div className="typo-code text-foreground/90">
          {execution.cost_usd > 0 ? `$${execution.cost_usd.toFixed(4)}` : '-'}
        </div>
      </div>
      <div className="rounded-card border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" /> {e.stages}
        </div>
        <div className="typo-code text-foreground/90">{stagesHit} / {PIPELINE_STAGES.length}</div>
      </div>
      <div className="rounded-card border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <AlertCircle className="w-2.5 h-2.5" /> {e.errors}
        </div>
        <div className={`typo-code ${errors > 0 ? 'text-red-400' : 'text-foreground/90'}`}>{errors}</div>
      </div>
    </div>
  );
}

// Waterfall error details

export function WaterfallErrors({ entries }: { entries: UnifiedSpan[] }) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const errorEntries = entries.filter(e => e.error && isPipelineStage(e.span_type));
  if (errorEntries.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="typo-code text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
        <AlertCircle className="w-2.5 h-2.5 text-red-400" /> {e.stage_errors}
      </div>
      {errorEntries.map((entry) => {
        const stage = entry.span_type as PipelineStage;
        const config = STAGE_COLORS[stage];
        return (
          <div key={entry.span_id} className="p-3 bg-red-500/5 border border-red-500/15 rounded-card">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`inline-flex px-1.5 py-0.5 typo-code uppercase rounded border ${config.bg} ${config.text} ${config.border}`}>
                {stage}
              </span>
            </div>
            <pre className="typo-code text-red-300/80 whitespace-pre-wrap break-words">
              {entry.error}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
