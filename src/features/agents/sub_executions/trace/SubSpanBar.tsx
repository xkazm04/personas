import { useState } from 'react';
import { formatDuration } from '@/lib/utils/formatters';
import type { ToolCallStep } from './stageColors';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Sub-span bar (tool calls within stream_output)
// ---------------------------------------------------------------------------

export function SubSpanBar({
  step,
  parentStartMs,
  totalDurationMs,
  pipelineStartMs,
}: {
  step: ToolCallStep;
  parentStartMs: number;
  totalDurationMs: number;
  pipelineStartMs: number;
}) {
  const { t, tx } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const stepOffsetInParent = step.started_at_ms;
  const stepDuration = step.duration_ms ?? 0;
  const absoluteStart = parentStartMs + stepOffsetInParent;
  const offsetFromPipeline = absoluteStart - pipelineStartMs;
  const leftPct = totalDurationMs > 0 ? (offsetFromPipeline / totalDurationMs) * 100 : 0;
  const widthPct = totalDurationMs > 0 ? Math.max((stepDuration / totalDurationMs) * 100, 0.3) : 0;

  return (
    <div
      className="grid grid-cols-[180px_1fr_70px] gap-2 items-center px-3 py-0.5 hover:bg-secondary/20 rounded transition-colors"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Left: indented tool name */}
      <div className="flex items-center gap-1.5 min-w-0 pl-8">
        <span className="w-4 flex-shrink-0" />
        <span className="inline-flex px-1.5 py-0.5 typo-code uppercase rounded border bg-cyan-500/10 text-cyan-400 border-cyan-500/20 flex-shrink-0">
          {t.agents.executions.tool_type_badge}
        </span>
        <span className="typo-code text-foreground/70 truncate">{step.tool_name}</span>
      </div>

      {/* Center: bar */}
      <div className="relative h-4 w-full">
        <div className="absolute inset-0 bg-primary/3 rounded" />
        <div
          className="absolute top-0.5 bottom-0.5 rounded bg-cyan-500/35 transition-all"
          style={{
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            minWidth: '2px',
          }}
        />
        {hovered && (
          <div
            className="absolute z-20 bottom-full mb-1 bg-background/95 border border-primary/20 rounded-modal px-3 py-2 shadow-elevation-3 backdrop-blur-sm whitespace-nowrap pointer-events-none"
            style={{ left: `${Math.min(leftPct, 70)}%` }}
          >
            <p className="typo-heading text-cyan-400 mb-1">{step.tool_name}</p>
            <div className="flex items-center gap-3 typo-body">
              <span className="font-mono text-foreground/70">{formatDuration(stepDuration)}</span>
              <span className="text-muted-foreground/50">{tx(t.agents.executions.step_number, { index: step.step_index })}</span>
            </div>
            {step.input_preview && (
              <p className="typo-body text-muted-foreground/50 mt-1 max-w-[200px] truncate">
                {t.agents.executions.input_preview_prefix} {step.input_preview}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Right: duration */}
      <span className="typo-code text-muted-foreground/50 text-right">
        {formatDuration(stepDuration)}
      </span>
    </div>
  );
}
