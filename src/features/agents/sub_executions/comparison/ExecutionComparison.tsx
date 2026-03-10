import { useMemo } from 'react';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { ArrowLeftRight, Zap, Hash, X } from 'lucide-react';
import { formatDuration, formatTimestamp, getStatusEntry, badgeClass } from '@/lib/utils/formatters';

import { parseToolSteps, fmtTokens, fmtCost, generateWhatChanged } from './comparisonHelpers';
import { MetricDeltaCard } from './MetricDeltaCard';
import { ToolTimelineComparison } from './ToolTimelineComparison';
import { OutputDiffSection } from './OutputDiffSection';
import { JsonDiffSection } from './JsonDiffSection';

// ─── Main Component ──────────────────────────────────────────────────────────

interface ExecutionComparisonProps {
  left: PersonaExecution;
  right: PersonaExecution;
  onClose: () => void;
}

export function ExecutionComparison({ left, right, onClose }: ExecutionComparisonProps) {
  const stepsLeft = useMemo(() => parseToolSteps(left.tool_steps), [left.tool_steps]);
  const stepsRight = useMemo(() => parseToolSteps(right.tool_steps), [right.tool_steps]);
  const whatChanged = useMemo(() => generateWhatChanged(left, right), [left, right]);

  const leftStatus = getStatusEntry(left.status);
  const rightStatus = getStatusEntry(right.status);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4 text-primary/70" />
          <h3 className="text-sm font-medium text-foreground/80">Execution Comparison</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* What Changed summary */}
      <div className="bg-primary/5 border border-primary/15 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-3.5 h-3.5 text-primary/60" />
          <span className="text-sm font-medium text-foreground/70 uppercase tracking-wider">What Changed</span>
        </div>
        <ul className="space-y-1">
          {whatChanged.map((change, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
              <span className="w-1 h-1 rounded-full bg-primary/40 mt-2 flex-shrink-0" />
              {change}
            </li>
          ))}
        </ul>
      </div>

      {/* Execution headers (side by side) */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-secondary/30 border border-primary/10 rounded-xl px-3 py-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-mono uppercase text-muted-foreground/50">Left</span>
            <span className={`px-1.5 py-0.5 rounded text-sm font-medium ${badgeClass(leftStatus)}`}>{leftStatus.label}</span>
            {left.retry_count > 0 && (
              <span className="text-sm text-cyan-400 font-mono">retry #{left.retry_count}</span>
            )}
          </div>
          <div className="text-sm text-muted-foreground/60 font-mono">#{left.id.slice(0, 8)}</div>
          <div className="text-sm text-muted-foreground/60 mt-0.5">{formatTimestamp(left.started_at)}</div>
        </div>
        <div className="bg-secondary/30 border border-primary/10 rounded-xl px-3 py-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-mono uppercase text-muted-foreground/50">Right</span>
            <span className={`px-1.5 py-0.5 rounded text-sm font-medium ${badgeClass(rightStatus)}`}>{rightStatus.label}</span>
            {right.retry_count > 0 && (
              <span className="text-sm text-cyan-400 font-mono">retry #{right.retry_count}</span>
            )}
          </div>
          <div className="text-sm text-muted-foreground/60 font-mono">#{right.id.slice(0, 8)}</div>
          <div className="text-sm text-muted-foreground/60 mt-0.5">{formatTimestamp(right.started_at)}</div>
        </div>
      </div>

      {/* Metrics delta cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricDeltaCard
          label="Input Tokens"
          leftVal={left.input_tokens}
          rightVal={right.input_tokens}
          format={fmtTokens}
        />
        <MetricDeltaCard
          label="Output Tokens"
          leftVal={left.output_tokens}
          rightVal={right.output_tokens}
          format={fmtTokens}
        />
        <MetricDeltaCard
          label="Cost"
          leftVal={left.cost_usd}
          rightVal={right.cost_usd}
          format={fmtCost}
        />
        <MetricDeltaCard
          label="Duration"
          leftVal={left.duration_ms ?? 0}
          rightVal={right.duration_ms ?? 0}
          format={(v) => formatDuration(v)}
        />
      </div>

      {/* Tool call timeline comparison */}
      {(stepsLeft.length > 0 || stepsRight.length > 0) && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Hash className="w-3.5 h-3.5 text-primary/50" />
            <span className="text-sm font-medium text-foreground/70 uppercase tracking-wider">Tool Call Timeline</span>
          </div>
          <ToolTimelineComparison stepsLeft={stepsLeft} stepsRight={stepsRight} />
        </div>
      )}

      {/* Terminal output diff */}
      <OutputDiffSection leftId={left.id} rightId={right.id} personaId={left.persona_id} />

      {/* Input data diff */}
      <JsonDiffSection label="Input Data Diff" leftData={left.input_data} rightData={right.input_data} />

      {/* Output data diff */}
      <JsonDiffSection label="Output Data Diff" leftData={left.output_data} rightData={right.output_data} />
    </div>
  );
}
