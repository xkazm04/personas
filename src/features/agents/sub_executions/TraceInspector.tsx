import { useState, useEffect, useMemo, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { DbPersonaExecution } from '@/lib/types/types';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import type { SpanType } from '@/lib/bindings/SpanType';
import { getExecutionTrace } from '@/api/executions';
import { formatDuration } from '@/lib/utils/formatters';
import { Clock, DollarSign, Zap, ChevronDown, ChevronRight, AlertCircle, Loader2, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ============================================================================
// Span type config
// ============================================================================

const SPAN_TYPE_CONFIG: Record<SpanType, { label: string; color: string; bg: string; border: string }> = {
  execution:             { label: 'Execution',      color: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25' },
  prompt_assembly:       { label: 'Prompt',          color: 'text-violet-400',  bg: 'bg-violet-500/15',  border: 'border-violet-500/25' },
  credential_resolution: { label: 'Credentials',     color: 'text-amber-400',   bg: 'bg-amber-500/15',   border: 'border-amber-500/25' },
  cli_spawn:             { label: 'CLI Spawn',       color: 'text-cyan-400',    bg: 'bg-cyan-500/15',    border: 'border-cyan-500/25' },
  tool_call:             { label: 'Tool Call',       color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' },
  protocol_dispatch:     { label: 'Protocol',        color: 'text-pink-400',    bg: 'bg-pink-500/15',    border: 'border-pink-500/25' },
  chain_evaluation:      { label: 'Chain Eval',      color: 'text-orange-400',  bg: 'bg-orange-500/15',  border: 'border-orange-500/25' },
  stream_processing:     { label: 'Stream',          color: 'text-sky-400',     bg: 'bg-sky-500/15',     border: 'border-sky-500/25' },
  outcome_assessment:    { label: 'Outcome',         color: 'text-lime-400',    bg: 'bg-lime-500/15',    border: 'border-lime-500/25' },
  healing_analysis:      { label: 'Healing',         color: 'text-red-400',     bg: 'bg-red-500/15',     border: 'border-red-500/25' },
};

// ============================================================================
// Tree node type
// ============================================================================

interface SpanNode {
  span: TraceSpan;
  children: SpanNode[];
  depth: number;
}

function buildSpanTree(spans: TraceSpan[]): SpanNode[] {
  const byId = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];

  // Create nodes
  for (const span of spans) {
    byId.set(span.span_id, { span, children: [], depth: 0 });
  }

  // Wire parent-child
  for (const span of spans) {
    const node = byId.get(span.span_id)!;
    if (span.parent_span_id) {
      const parent = byId.get(span.parent_span_id);
      if (parent) {
        node.depth = parent.depth + 1;
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }

  // Sort children by start_ms
  const sortChildren = (node: SpanNode) => {
    node.children.sort((a, b) => a.span.start_ms - b.span.start_ms);
    node.children.forEach(sortChildren);
  };
  roots.forEach(sortChildren);

  return roots;
}

function flattenTree(nodes: SpanNode[]): SpanNode[] {
  const result: SpanNode[] = [];
  const walk = (node: SpanNode) => {
    result.push(node);
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return result;
}

// ============================================================================
// Waterfall bar component
// ============================================================================

function WaterfallBar({ span, totalMs }: { span: TraceSpan; totalMs: number }) {
  if (!totalMs || totalMs === 0) return null;

  const leftPct = (span.start_ms / totalMs) * 100;
  const widthPct = span.duration_ms != null
    ? Math.max((span.duration_ms / totalMs) * 100, 0.5)
    : Math.max(((totalMs - span.start_ms) / totalMs) * 100, 0.5);

  const config = SPAN_TYPE_CONFIG[span.span_type];

  return (
    <div className="relative h-5 w-full">
      {/* Track */}
      <div className="absolute inset-0 bg-primary/5 rounded" />
      {/* Bar */}
      <div
        className={`absolute top-0.5 bottom-0.5 rounded ${span.error ? 'bg-red-500/40' : config.bg} transition-all`}
        style={{
          left: `${leftPct}%`,
          width: `${widthPct}%`,
          minWidth: '2px',
        }}
      />
      {/* Duration label */}
      {span.duration_ms != null && (
        <span
          className="absolute top-0 text-[10px] font-mono text-muted-foreground/60 leading-5 whitespace-nowrap"
          style={{ left: `${Math.min(leftPct + widthPct + 0.5, 85)}%` }}
        >
          {formatDuration(span.duration_ms)}
        </span>
      )}
    </div>
  );
}

// ============================================================================
// Span row component
// ============================================================================

function SpanRow({
  node,
  totalMs,
  expanded,
  onToggle,
  hasChildren,
}: {
  node: SpanNode;
  totalMs: number;
  expanded: boolean;
  onToggle: () => void;
  hasChildren: boolean;
}) {
  const { span, depth } = node;
  const config = SPAN_TYPE_CONFIG[span.span_type];

  return (
    <div
      className={`group grid grid-cols-[minmax(200px,1fr)_minmax(200px,2fr)] gap-2 items-center px-2 py-1 hover:bg-secondary/30 rounded transition-colors ${
        span.error ? 'bg-red-500/5' : ''
      }`}
    >
      {/* Left: name + type badge */}
      <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: `${depth * 16}px` }}>
        {hasChildren ? (
          <button onClick={onToggle} className="p-0.5 rounded hover:bg-primary/10 flex-shrink-0">
            {expanded ? (
              <ChevronDown className="w-3 h-3 text-muted-foreground/70" />
            ) : (
              <ChevronRight className="w-3 h-3 text-muted-foreground/70" />
            )}
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}

        <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase rounded border ${config.bg} ${config.color} ${config.border} flex-shrink-0`}>
          {config.label}
        </span>

        <span className="text-sm font-mono text-foreground/85 truncate" title={span.name}>
          {span.name}
        </span>

        {span.error && (
          <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
        )}

        {span.cost_usd != null && span.cost_usd > 0 && (
          <span className="text-[10px] font-mono text-amber-400/70 flex-shrink-0">
            ${span.cost_usd.toFixed(4)}
          </span>
        )}
      </div>

      {/* Right: waterfall bar */}
      <WaterfallBar span={span} totalMs={totalMs} />
    </div>
  );
}

// ============================================================================
// Trace summary cards
// ============================================================================

function TraceSummary({ trace }: { trace: ExecutionTrace }) {
  const stats = useMemo(() => {
    const rootSpan = trace.spans.find(s => s.span_type === 'execution');
    const toolCalls = trace.spans.filter(s => s.span_type === 'tool_call');
    const totalCost = rootSpan?.cost_usd ?? 0;
    const totalInput = rootSpan?.input_tokens ?? 0;
    const totalOutput = rootSpan?.output_tokens ?? 0;
    const errors = trace.spans.filter(s => s.error != null);

    return { totalCost, totalInput, totalOutput, toolCallCount: toolCalls.length, errorCount: errors.length };
  }, [trace.spans]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <div className="rounded-lg border border-primary/15 bg-secondary/40 p-3 space-y-1">
        <div className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          Duration
        </div>
        <div className="text-sm font-mono text-foreground/90">
          {formatDuration(trace.total_duration_ms)}
        </div>
      </div>

      <div className="rounded-lg border border-primary/15 bg-secondary/40 p-3 space-y-1">
        <div className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <DollarSign className="w-2.5 h-2.5" />
          Cost
        </div>
        <div className="text-sm font-mono text-foreground/90">
          {stats.totalCost > 0 ? `$${stats.totalCost.toFixed(4)}` : '-'}
        </div>
      </div>

      <div className="rounded-lg border border-primary/15 bg-secondary/40 p-3 space-y-1">
        <div className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" />
          Tokens
        </div>
        <div className="text-sm font-mono text-foreground/90">
          {(stats.totalInput + stats.totalOutput).toLocaleString()}
        </div>
      </div>

      <div className="rounded-lg border border-primary/15 bg-secondary/40 p-3 space-y-1">
        <div className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <Activity className="w-2.5 h-2.5" />
          Spans
        </div>
        <div className="text-sm font-mono text-foreground/90">
          {trace.spans.length}
        </div>
      </div>

      <div className="rounded-lg border border-primary/15 bg-secondary/40 p-3 space-y-1">
        <div className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <AlertCircle className="w-2.5 h-2.5" />
          Errors
        </div>
        <div className={`text-sm font-mono ${stats.errorCount > 0 ? 'text-red-400' : 'text-foreground/90'}`}>
          {stats.errorCount}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

interface TraceInspectorProps {
  execution: DbPersonaExecution;
}

export function TraceInspector({ execution }: TraceInspectorProps) {
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSpans, setCollapsedSpans] = useState<Set<string>>(new Set());

  // Fetch trace data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getExecutionTrace(execution.id, execution.persona_id)
      .then((t) => {
        if (!cancelled) {
          setTrace(t);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [execution.id]);

  // Listen for live trace updates (complete trace emitted on finish)
  useEffect(() => {
    const unlisten = listen<ExecutionTrace>('execution-trace', (event) => {
      if (event.payload.execution_id === execution.id) {
        setTrace(event.payload);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, [execution.id]);

  // Listen for live span events
  useEffect(() => {
    const unlisten = listen<{ execution_id: string; span: TraceSpan; event_type: string }>(
      'execution-trace-span',
      (event) => {
        if (event.payload.execution_id !== execution.id) return;
        setTrace((prev) => {
          if (!prev) return prev;
          const { span, event_type } = event.payload;
          const existingIdx = prev.spans.findIndex(s => s.span_id === span.span_id);
          const newSpans = [...prev.spans];
          if (event_type === 'start' && existingIdx === -1) {
            newSpans.push(span);
          } else if (event_type === 'end' && existingIdx >= 0) {
            newSpans[existingIdx] = span;
          }
          return { ...prev, spans: newSpans };
        });
      },
    );
    return () => { unlisten.then(fn => fn()); };
  }, [execution.id]);

  const toggleSpan = useCallback((spanId: string) => {
    setCollapsedSpans((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  }, []);

  // Build tree + visible flat list
  const { visibleNodes, totalMs } = useMemo(() => {
    if (!trace) return { visibleNodes: [], totalMs: 0 };

    const tree = buildSpanTree(trace.spans);
    const allFlat = flattenTree(tree);

    // Filter out collapsed children
    const isAncestorCollapsed = (node: SpanNode): boolean => {
      // Walk up via parent_span_id
      let currentParentId = node.span.parent_span_id;
      while (currentParentId) {
        if (collapsedSpans.has(currentParentId)) return true;
        const parent = trace.spans.find(s => s.span_id === currentParentId);
        currentParentId = parent?.parent_span_id ?? null;
      }
      return false;
    };

    const visible = allFlat.filter(n => !isAncestorCollapsed(n));
    const total = trace.total_duration_ms ?? 0;

    return { visibleNodes: visible, totalMs: total };
  }, [trace, collapsedSpans]);

  // Children lookup for expand/collapse icons
  const childrenMap = useMemo(() => {
    if (!trace) return new Map<string, boolean>();
    const map = new Map<string, boolean>();
    for (const span of trace.spans) {
      if (span.parent_span_id) {
        map.set(span.parent_span_id, true);
      }
    }
    return map;
  }, [trace]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/80" />
        <span className="ml-2 text-sm text-muted-foreground/80">Loading trace...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-300/80 font-mono">
        Failed to load trace: {error}
      </div>
    );
  }

  if (!trace || trace.spans.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/60 border border-primary/15 flex items-center justify-center">
          <Activity className="w-6 h-6 text-muted-foreground/60" />
        </div>
        <p className="text-sm text-muted-foreground/80">No trace data recorded</p>
        <p className="text-sm text-muted-foreground/60 mt-1">Trace spans appear during execution</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TraceSummary trace={trace} />

      {/* Time axis header */}
      <div className="rounded-xl border border-primary/15 bg-secondary/30 overflow-hidden">
        <div className="grid grid-cols-[minmax(200px,1fr)_minmax(200px,2fr)] gap-2 px-2 py-1.5 border-b border-primary/10 bg-secondary/40">
          <div className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">
            Span
          </div>
          <div className="flex justify-between text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">
            <span>0ms</span>
            <span>{formatDuration(totalMs)}</span>
          </div>
        </div>

        {/* Span rows */}
        <div className="max-h-[500px] overflow-y-auto">
          <AnimatePresence initial={false}>
            {visibleNodes.map((node) => (
              <motion.div
                key={node.span.span_id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.1 }}
              >
                <SpanRow
                  node={node}
                  totalMs={totalMs}
                  expanded={!collapsedSpans.has(node.span.span_id)}
                  onToggle={() => toggleSpan(node.span.span_id)}
                  hasChildren={childrenMap.has(node.span.span_id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Error details */}
      {trace.spans.some(s => s.error) && (
        <div className="space-y-2">
          <div className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="w-2.5 h-2.5 text-red-400" />
            Errors
          </div>
          {trace.spans
            .filter(s => s.error)
            .map((span) => {
              const config = SPAN_TYPE_CONFIG[span.span_type];
              return (
                <div key={span.span_id} className="p-3 bg-red-500/5 border border-red-500/15 rounded-lg">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase rounded border ${config.bg} ${config.color} ${config.border}`}>
                      {config.label}
                    </span>
                    <span className="text-sm font-mono text-foreground/80">{span.name}</span>
                  </div>
                  <pre className="text-sm text-red-300/80 font-mono whitespace-pre-wrap break-words">
                    {span.error}
                  </pre>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
