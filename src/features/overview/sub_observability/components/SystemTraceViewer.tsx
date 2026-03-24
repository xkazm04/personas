import { useState, useMemo, useCallback } from 'react';
import { Activity, Trash2, AlertCircle, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { useSystemTraces } from '@/hooks/execution/useSystemTrace';
import { SYSTEM_OPERATION_CONFIG, getSpanConfig } from '@/features/agents/sub_executions/libs/traceHelpers';
import { buildSpanTree, flattenTree } from '@/features/agents/sub_executions/libs/traceHelpers';
import type { SystemTrace } from '@/lib/execution/systemTrace';
import type { SystemOperationType } from '@/lib/execution/pipeline';
import { formatDuration } from '@/lib/utils/formatters';
import type { UnifiedSpan } from '@/lib/execution/pipeline';

function TraceCard({ trace }: { trace: SystemTrace }) {
  const [expanded, setExpanded] = useState(false);
  const [collapsedSpans, setCollapsedSpans] = useState<Set<string>>(new Set());

  const config = SYSTEM_OPERATION_CONFIG[trace.operationType];
  const duration = trace.completedAt ? trace.completedAt - trace.startedAt : null;
  const hasErrors = trace.spans.some((s) => s.error);
  const isActive = !trace.completedAt;

  const toggleSpan = useCallback((spanId: string) => {
    setCollapsedSpans((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  }, []);

  const { visibleNodes, totalMs, childrenMap } = useMemo(() => {
    const tree = buildSpanTree(trace.spans);
    const allFlat = flattenTree(tree);

    const isAncestorCollapsed = (node: typeof allFlat[0]): boolean => {
      let currentParentId = node.span.parent_span_id;
      while (currentParentId) {
        if (collapsedSpans.has(currentParentId)) return true;
        const parent = trace.spans.find((s) => s.span_id === currentParentId);
        currentParentId = parent?.parent_span_id ?? null;
      }
      return false;
    };

    const visible = allFlat.filter((n) => !isAncestorCollapsed(n));
    const total = duration ?? Math.max(0, ...trace.spans.map((s) => s.end_ms ?? s.start_ms + (s.duration_ms ?? 0)));
    const children = new Map<string, boolean>();
    for (const span of trace.spans) {
      if (span.parent_span_id) children.set(span.parent_span_id, true);
    }

    return { visibleNodes: visible, totalMs: total, childrenMap: children };
  }, [trace.spans, collapsedSpans, duration]);

  return (
    <div className={`rounded-lg border ${hasErrors ? 'border-red-500/30' : 'border-primary/15'} bg-secondary/30 overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
        )}
        <span className={`inline-flex px-1.5 py-0.5 typo-code uppercase rounded border ${config.bg} ${config.color} ${config.border} shrink-0`}>
          {config.label}
        </span>
        <span className="typo-code text-foreground/85 truncate flex-1">{trace.label}</span>

        {isActive && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code text-blue-400 bg-blue-500/10 rounded border border-blue-500/20 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Active
          </span>
        )}

        {hasErrors && (
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
        )}

        <span className="typo-code text-muted-foreground/60 shrink-0 flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          {duration != null ? formatDuration(duration) : '...'}
        </span>

        <span className="typo-code text-muted-foreground/50 shrink-0">
          {trace.spans.length} span{trace.spans.length !== 1 ? 's' : ''}
        </span>

        <span className="typo-code text-muted-foreground/40 shrink-0">
          {new Date(trace.startedAt).toLocaleTimeString()}
        </span>
      </button>

      {expanded && (
          <div className="animate-fade-slide-in"
          >
            <div className="border-t border-primary/10">
              {/* Time axis */}
              <div className="grid grid-cols-[minmax(180px,1fr)_minmax(180px,2fr)] gap-2 px-2 py-1 bg-secondary/40">
                <div className="typo-code text-muted-foreground/50 uppercase tracking-wider">Span</div>
                <div className="flex justify-between typo-code text-muted-foreground/50 uppercase tracking-wider">
                  <span>0ms</span>
                  <span>{formatDuration(totalMs)}</span>
                </div>
              </div>

              {/* Span rows */}
              <div className="max-h-[300px] overflow-y-auto">
                {visibleNodes.map((node) => (
                  <SpanRowCompact
                    key={node.span.span_id}
                    span={node.span}
                    depth={node.depth}
                    totalMs={totalMs}
                    hasChildren={childrenMap.has(node.span.span_id)}
                    expanded={!collapsedSpans.has(node.span.span_id)}
                    onToggle={() => toggleSpan(node.span.span_id)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

function SpanRowCompact({
  span,
  depth,
  totalMs,
  hasChildren,
  expanded,
  onToggle,
}: {
  span: UnifiedSpan;
  depth: number;
  totalMs: number;
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const config = getSpanConfig(span.span_type);

  const leftPct = totalMs > 0 ? (span.start_ms / totalMs) * 100 : 0;
  const widthPct = totalMs > 0
    ? span.duration_ms != null
      ? Math.max((span.duration_ms / totalMs) * 100, 0.5)
      : Math.max(((totalMs - span.start_ms) / totalMs) * 100, 0.5)
    : 100;

  return (
    <div className={`grid grid-cols-[minmax(180px,1fr)_minmax(180px,2fr)] gap-2 items-center px-2 py-0.5 hover:bg-secondary/30 ${span.error ? 'bg-red-500/5' : ''}`}>
      <div className="flex items-center gap-1 min-w-0" style={{ paddingLeft: `${depth * 14}px` }}>
        {hasChildren ? (
          <button onClick={onToggle} className="p-0.5 rounded hover:bg-primary/10 shrink-0">
            {expanded ? <ChevronDown className="w-2.5 h-2.5 text-muted-foreground/60" /> : <ChevronRight className="w-2.5 h-2.5 text-muted-foreground/60" />}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className={`inline-flex px-1 py-0.5 text-[10px] uppercase rounded border ${config.bg} ${config.color} ${config.border} shrink-0`}>
          {config.label}
        </span>
        <span className="typo-code text-foreground/80 truncate">{span.name}</span>
        {span.error && <AlertCircle className="w-2.5 h-2.5 text-red-400 shrink-0" />}
      </div>

      <div className="relative h-4">
        <div className="absolute inset-0 bg-primary/5 rounded" />
        <div
          className={`absolute top-0.5 bottom-0.5 rounded ${span.error ? 'bg-red-500/40' : config.bg}`}
          style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: '2px' }}
        />
        {span.duration_ms != null && (
          <span className="absolute top-0 typo-code text-muted-foreground/50 leading-4 text-[10px]" style={{ left: `${Math.min(leftPct + widthPct + 0.5, 85)}%` }}>
            {formatDuration(span.duration_ms)}
          </span>
        )}
      </div>
    </div>
  );
}

export default function SystemTraceViewer() {
  const { traces, activeCount, errorCount, clear } = useSystemTraces();
  const [filter, setFilter] = useState<SystemOperationType | 'all'>('all');

  const filtered = useMemo(
    () => filter === 'all' ? traces : traces.filter((t) => t.operationType === filter),
    [traces, filter],
  );

  const operationTypes = useMemo(() => {
    const types = new Set(traces.map((t) => t.operationType));
    return Array.from(types).sort();
  }, [traces]);

  if (traces.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/60 border border-primary/20 flex items-center justify-center">
          <Activity className="w-6 h-6 text-muted-foreground/60" />
        </div>
        <p className="typo-body text-muted-foreground/80">No system traces recorded</p>
        <p className="typo-body text-muted-foreground/60 mt-1">
          Traces appear when design, credential, or template operations run
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="typo-code text-muted-foreground/70">
            {traces.length} trace{traces.length !== 1 ? 's' : ''}
          </span>
          {activeCount > 0 && (
            <span className="typo-code text-blue-400">
              {activeCount} active
            </span>
          )}
          {errorCount > 0 && (
            <span className="typo-code text-red-400">
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as SystemOperationType | 'all')}
            className="typo-code bg-secondary/60 border border-primary/20 rounded px-2 py-1 text-foreground/80"
          >
            <option value="all">All operations</option>
            {operationTypes.map((type) => (
              <option key={type} value={type}>
                {SYSTEM_OPERATION_CONFIG[type as SystemOperationType]?.label ?? type}
              </option>
            ))}
          </select>

          <button
            onClick={clear}
            className="p-1.5 rounded hover:bg-secondary/60 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
            title="Clear completed traces"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Trace list */}
      <div className="space-y-2">
        {filtered.map((trace) => (
          <TraceCard key={trace.traceId} trace={trace} />
        ))}
      </div>
    </div>
  );
}
