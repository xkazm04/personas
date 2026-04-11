import { useMemo } from 'react';
import {
  Activity,
  Brain,
  Key,
  Terminal,
  Wrench,
  MessageSquare,
  Link2,
  Eye,
  Stethoscope,
  Cpu,
  Layers,
} from 'lucide-react';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import type { SpanType } from '@/lib/bindings/SpanType';
import { formatDuration } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

interface ReplayTracePanelProps {
  /** All trace spans from the backend execution trace. */
  spans: TraceSpan[];
  /** Current scrub position in ms. */
  currentMs: number;
  /** Total execution duration. */
  totalMs: number;
}

/** Icon + color mapping for each span type. */
const SPAN_CONFIG: Record<SpanType, { icon: typeof Activity; label: string; color: string }> = {
  execution:              { icon: Cpu,            label: 'Execution',           color: 'text-violet-400' },
  prompt_assembly:        { icon: Brain,          label: 'Prompt Assembly',     color: 'text-purple-400' },
  credential_resolution:  { icon: Key,            label: 'Credential',          color: 'text-amber-400' },
  cli_spawn:              { icon: Terminal,        label: 'CLI Spawn',           color: 'text-emerald-400' },
  tool_call:              { icon: Wrench,          label: 'Tool Call',           color: 'text-cyan-400' },
  protocol_dispatch:      { icon: MessageSquare,   label: 'Protocol',            color: 'text-blue-400' },
  chain_evaluation:       { icon: Link2,           label: 'Chain Eval',          color: 'text-orange-400' },
  stream_processing:      { icon: Activity,        label: 'Stream',              color: 'text-teal-400' },
  outcome_assessment:     { icon: Eye,             label: 'Outcome',             color: 'text-indigo-400' },
  healing_analysis:       { icon: Stethoscope,     label: 'Healing',             color: 'text-rose-400' },
  pipeline_stage:         { icon: Layers,          label: 'Pipeline Stage',      color: 'text-indigo-400' },
};

/**
 * Panel showing trace spans active/completed at the current scrub position.
 * Provides insight into what the engine was doing at each moment.
 */
export function ReplayTracePanel({ spans, currentMs }: ReplayTracePanelProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  // Categorize spans at current position
  const { activeSpans, completedSpans, pendingSpans } = useMemo(() => {
    const active: TraceSpan[] = [];
    const completed: TraceSpan[] = [];
    const pending: TraceSpan[] = [];

    for (const span of spans) {
      // Skip the root execution span
      if (span.span_type === 'execution' && !span.parent_span_id) continue;

      if (span.start_ms > currentMs) {
        pending.push(span);
      } else if (span.end_ms != null && span.end_ms <= currentMs) {
        completed.push(span);
      } else {
        active.push(span);
      }
    }

    return {
      activeSpans: active.sort((a, b) => a.start_ms - b.start_ms),
      completedSpans: completed.sort((a, b) => (b.end_ms ?? 0) - (a.end_ms ?? 0)).slice(0, 8),
      pendingSpans: pending.sort((a, b) => a.start_ms - b.start_ms).slice(0, 5),
    };
  }, [spans, currentMs]);

  if (spans.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
          <Activity className="w-3.5 h-3.5 text-muted-foreground/60" />
          <span className="typo-heading text-muted-foreground/70">{e.trace_spans}</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="typo-body text-muted-foreground/50 italic">{e.no_trace_available}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
        <Activity className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="typo-heading text-muted-foreground/70">{e.engine_activity}</span>
        <span className="ml-auto typo-body tabular-nums text-muted-foreground/50">
          {tx(e.active_count, { count: activeSpans.length })}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {/* Active spans */}
        {activeSpans.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-mono text-blue-400/60 uppercase tracking-wider px-1">
              {e.active_now}
            </div>
            {activeSpans.map((span) => (
              <SpanCard key={span.span_id} span={span} variant="active" currentMs={currentMs} />
            ))}
          </div>
        )}

        {/* Recently completed */}
        {completedSpans.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-mono text-emerald-400/60 uppercase tracking-wider px-1">
              {e.recently_completed}
            </div>
            {completedSpans.map((span) => (
              <SpanCard key={span.span_id} span={span} variant="completed" currentMs={currentMs} />
            ))}
          </div>
        )}

        {/* Upcoming */}
        {pendingSpans.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-wider px-1">
              {e.upcoming}
            </div>
            {pendingSpans.map((span) => (
              <SpanCard key={span.span_id} span={span} variant="pending" currentMs={currentMs} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SpanCard({
  span,
  variant,
  currentMs,
}: {
  span: TraceSpan;
  variant: 'active' | 'completed' | 'pending';
  currentMs: number;
}) {
  const config = SPAN_CONFIG[span.span_type];
  const Icon = config?.icon ?? Activity;
  const label = config?.label ?? span.span_type;
  const color = config?.color ?? 'text-muted-foreground/60';

  // Extract useful metadata
  const toolName = span.metadata && typeof span.metadata === 'object' && !Array.isArray(span.metadata)
    ? (span.metadata as Record<string, unknown>).tool_name as string | undefined
    : undefined;

  return (
    <div className={`rounded-lg border px-2.5 py-1.5 transition-all ${
      variant === 'active'
        ? 'border-blue-400/30 bg-blue-500/8'
        : variant === 'completed'
          ? 'border-primary/10 bg-secondary/20'
          : 'border-primary/5 bg-secondary/10 opacity-50'
    }`}>
      <div className="flex items-center gap-2">
        <Icon className={`w-3 h-3 shrink-0 ${variant === 'pending' ? 'text-muted-foreground/30' : color}`} />
        <span className={`typo-code truncate${
          variant === 'pending' ? 'text-muted-foreground/40' : 'text-foreground/80'
        }`}>
          {toolName ? `${label}: ${toolName}` : span.name}
        </span>
        {variant === 'active' && (
          <span className="ml-auto text-[10px] font-mono text-blue-400/60 tabular-nums shrink-0">
            {formatDuration(currentMs - span.start_ms)}
          </span>
        )}
        {variant === 'completed' && span.duration_ms != null && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground/50 tabular-nums shrink-0">
            {formatDuration(span.duration_ms)}
          </span>
        )}
      </div>

      {/* Error indicator */}
      {span.error && (
        <div className="mt-1 text-[11px] text-red-400/80 font-mono truncate">
          {span.error}
        </div>
      )}

      {/* Token info for active spans */}
      {variant === 'active' && (span.input_tokens || span.output_tokens) && (
        <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-muted-foreground/40">
          {span.input_tokens != null && <span>{span.input_tokens.toLocaleString()} in</span>}
          {span.output_tokens != null && <span>{span.output_tokens.toLocaleString()} out</span>}
          {span.cost_usd != null && span.cost_usd > 0 && <span>${span.cost_usd.toFixed(4)}</span>}
        </div>
      )}
    </div>
  );
}
