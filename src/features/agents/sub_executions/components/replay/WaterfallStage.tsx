import { useState } from 'react';
import type { UnifiedSpan, PipelineStage } from '@/lib/execution/pipeline';
import { STAGE_META, isPipelineStage } from '@/lib/execution/pipeline';
import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';
import { STAGE_COLORS, type ToolCallStep } from '../../libs/waterfallHelpers';
import { useTranslation } from '@/i18n/useTranslation';

// Stage bar component

interface StageBarProps {
  entry: UnifiedSpan;
  totalDurationMs: number;
  isExpanded: boolean;
  onToggle: () => void;
  hasSubSpans: boolean;
}

export function StageBar({
  entry,
  totalDurationMs,
  isExpanded,
  onToggle,
  hasSubSpans,
}: StageBarProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);

  if (!isPipelineStage(entry.span_type)) return null;
  const stage = entry.span_type as PipelineStage;
  const config = STAGE_COLORS[stage];
  const meta = STAGE_META[stage];
  const offsetMs = entry.start_ms;
  const durationMs = entry.duration_ms ?? 0;
  const leftPct = totalDurationMs > 0 ? (offsetMs / totalDurationMs) * 100 : 0;
  const widthPct = totalDurationMs > 0 ? Math.max((durationMs / totalDurationMs) * 100, 0.5) : 0;

  return (
    <div
      className="group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="grid grid-cols-[180px_1fr_70px] gap-2 items-center px-3 py-1.5 hover:bg-secondary/30 rounded transition-colors">
        {/* Left: stage label */}
        <div className="flex items-center gap-1.5 min-w-0">
          {hasSubSpans ? (
            <button onClick={onToggle} className="p-0.5 rounded hover:bg-primary/10 flex-shrink-0">
              {isExpanded ? (
                <ChevronDown className="w-3 h-3 text-foreground" />
              ) : (
                <ChevronRight className="w-3 h-3 text-foreground" />
              )}
            </button>
          ) : (
            <span className="w-4 flex-shrink-0" />
          )}
          <span className={`inline-flex px-1.5 py-0.5 typo-code uppercase rounded border ${config.bg} ${config.text} ${config.border} flex-shrink-0`}>
            {config.category}
          </span>
          <span className="typo-heading text-foreground/85 truncate">{meta.label}</span>
          {entry.error && <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />}
        </div>

        {/* Center: waterfall bar */}
        <div className="relative h-6 w-full">
          <div className="absolute inset-0 bg-primary/5 rounded" />
          <div
            className={`absolute top-1 bottom-1 rounded ${entry.error ? 'bg-red-500/40' : config.bar} transition-all`}
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              minWidth: '3px',
            }}
          />
          {/* Hover tooltip */}
          {hovered && (
            <div
              className="absolute z-20 bottom-full mb-1 bg-background/95 border border-primary/20 rounded-modal px-3 py-2 shadow-elevation-3 backdrop-blur-sm whitespace-nowrap pointer-events-none"
              style={{ left: `${Math.min(leftPct, 70)}%` }}
            >
              <p className="typo-heading text-foreground/90 mb-1">{meta.label}</p>
              <p className="typo-body text-foreground mb-1">{meta.boundary}</p>
              <div className="flex items-center gap-3 typo-body">
                <span className="font-mono text-foreground">{formatDuration(durationMs)}</span>
                <span className="text-foreground">{t.agents.executions.offset_prefix} {formatDuration(offsetMs)}</span>
              </div>
              {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {Object.entries(entry.metadata).map(([k, v]) => (
                    <div key={k} className="typo-body text-foreground">
                      <span className="text-foreground">{k}:</span>{' '}
                      <span className="font-mono">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: duration */}
        <span className="typo-code text-foreground text-right">
          {formatDuration(durationMs)}
        </span>
      </div>
    </div>
  );
}

// Sub-span bar (tool calls within stream_output)

interface SubSpanBarProps {
  step: ToolCallStep;
  parentStartMs: number;
  totalDurationMs: number;
}

export function SubSpanBar({
  step,
  parentStartMs,
  totalDurationMs,
}: SubSpanBarProps) {
  const { t, tx } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const stepOffsetInParent = step.started_at_ms;
  const stepDuration = step.duration_ms ?? 0;
  // parentStartMs is relative to trace start (span.start_ms)
  const absoluteOffset = parentStartMs + stepOffsetInParent;
  const leftPct = totalDurationMs > 0 ? (absoluteOffset / totalDurationMs) * 100 : 0;
  const widthPct = totalDurationMs > 0 ? Math.max((stepDuration / totalDurationMs) * 100, 0.3) : 0;

  return (
    <div
      className="grid grid-cols-[180px_1fr_70px] gap-2 items-center px-3 py-0.5 hover:bg-secondary/20 rounded transition-colors"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-1.5 min-w-0 pl-8">
        <span className="w-4 flex-shrink-0" />
        <span className="inline-flex px-1.5 py-0.5 typo-code uppercase rounded border bg-cyan-500/10 text-cyan-400 border-cyan-500/20 flex-shrink-0">
          {t.agents.executions.tool_type_badge}
        </span>
        <span className="typo-code text-foreground truncate">{step.tool_name}</span>
      </div>

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
              <span className="font-mono text-foreground">{formatDuration(stepDuration)}</span>
              <span className="text-foreground">{tx(t.agents.executions.step_number, { index: step.step_index })}</span>
            </div>
            {step.input_preview && (
              <p className="typo-body text-foreground mt-1 max-w-[200px] truncate">
                {t.agents.executions.input_preview_prefix} {step.input_preview}
              </p>
            )}
          </div>
        )}
      </div>

      <span className="typo-code text-foreground text-right">
        {formatDuration(stepDuration)}
      </span>
    </div>
  );
}
