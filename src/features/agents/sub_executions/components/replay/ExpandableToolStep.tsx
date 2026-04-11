import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  GitFork,
  Clock,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { ToolCallStep } from '@/hooks/execution/useReplayTimeline';
import { formatDuration } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

interface ExpandableToolStepProps {
  step: ToolCallStep;
  state: 'completed' | 'active' | 'pending';
  isFork: boolean;
  onFork: (idx: number | null) => void;
}

/**
 * Rich tool step card with expandable input/output details.
 * Shows tool name, duration, status, and on expand reveals
 * the input parameters and output preview.
 */
export function ExpandableToolStep({ step, state, isFork, onFork }: ExpandableToolStepProps) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const [expanded, setExpanded] = useState(false);

  const canExpand = state !== 'pending' && (step.input_preview || step.output_preview);

  return (
    <div
      className={`rounded-xl border transition-all ${
        isFork
          ? 'border-amber-400/50 bg-amber-500/10 ring-1 ring-amber-400/30'
          : state === 'active'
            ? 'border-blue-400/40 bg-blue-500/10 ring-1 ring-blue-400/20'
            : state === 'completed'
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : 'border-primary/10 bg-secondary/20 opacity-40'
      }`}
    >
      {/* Header row */}
      <div
        className={`flex items-center gap-2 px-3 py-2 ${canExpand ? 'cursor-pointer' : ''}`}
        onClick={() => canExpand && setExpanded(!expanded)}
      >
        {/* Expand chevron */}
        {canExpand ? (
          expanded ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground/50 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* Step number */}
        <span className={`typo-code tabular-nums${
          state === 'active' ? 'text-blue-400' :
          state === 'completed' ? 'text-emerald-400' : 'text-muted-foreground/40'
        }`}>
          {step.step_index + 1}
        </span>

        {/* Status dot */}
        {state === 'active' ? (
          <LoadingSpinner size="xs" className="text-blue-400 shrink-0" />
        ) : state === 'completed' ? (
          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
        ) : (
          <Circle className="w-3 h-3 text-muted-foreground/20 shrink-0" />
        )}

        {/* Tool name */}
        <span className={`typo-code truncate${
          state === 'pending' ? 'text-muted-foreground/40' : 'text-foreground/80'
        }`}>
          {step.tool_name}
        </span>

        {/* Duration */}
        {step.duration_ms != null && state === 'completed' && (
          <span className="ml-auto flex items-center gap-1 typo-code text-muted-foreground/60 tabular-nums shrink-0">
            <Clock className="w-2.5 h-2.5" />
            {formatDuration(step.duration_ms)}
          </span>
        )}

        {/* Active progress */}
        {state === 'active' && step.started_at_ms != null && (
          <span className="ml-auto typo-code text-blue-400/70 tabular-nums shrink-0">
            {e.running_ellipsis}
          </span>
        )}

        {/* Fork indicator */}
        {isFork && (
          <GitFork className="w-3 h-3 text-amber-400 shrink-0" />
        )}
      </div>

      {/* Expandable details */}
      {expanded && canExpand && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2 border-t border-primary/10 pt-2 mx-2">
              {/* Input preview */}
              {step.input_preview && (
                <div>
                  <div className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-1">
                    {e.input}
                  </div>
                  <pre className="typo-code text-foreground/70 bg-secondary/40 rounded-lg p-2 overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
                    {formatPreview(step.input_preview)}
                  </pre>
                </div>
              )}

              {/* Output preview */}
              {step.output_preview && state !== 'active' && (
                <div>
                  <div className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-1">
                    {e.output}
                  </div>
                  <pre className="typo-code text-foreground/70 bg-secondary/40 rounded-lg p-2 overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
                    {formatPreview(step.output_preview)}
                  </pre>
                </div>
              )}

              {/* Fork action */}
              {(state === 'completed' || state === 'active') && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onFork(isFork ? null : step.step_index);
                  }}
                  className={`flex items-center gap-1.5 typo-heading px-2.5 py-1 rounded-lg transition-colors${
                    isFork
                      ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                      : 'bg-secondary/40 text-muted-foreground/60 hover:text-muted-foreground/80 hover:bg-secondary/60'
                  }`}
                >
                  <GitFork className="w-3 h-3" />
                  {isFork ? e.clear_fork_point : e.fork_after_this}
                </button>
              )}
            </div>
          </div>
        )}
    </div>
  );
}

/** Try to pretty-print JSON; fallback to raw string. */
function formatPreview(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}
