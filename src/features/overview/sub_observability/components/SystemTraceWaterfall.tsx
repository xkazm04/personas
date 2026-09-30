/**
 * Observability (composition kit): one system trace's span waterfall. Span names on the reading
 * line, indented by depth, a parent collapses its children; each bar is placed on the trace's
 * own time axis in the primary tone (an errored span in the error tone). A chart, so its layout
 * is local; its type and colour are tokens.
 */
import { useCallback, useMemo, useState } from 'react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Dot, KitButton, toneColor } from '@/features/shared/components/kit';
import { buildSpanTree, flattenTree, getSpanConfig } from '@/features/agents/sub_executions/libs/traceHelpers';
import type { SystemTrace } from '@/lib/execution/systemTrace';

const GRID = { display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(180px, 2fr)', gap: 12, alignItems: 'center' } as const;

export function SystemTraceWaterfall({ trace }: { trace: SystemTrace }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }), []);

  const { nodes, totalMs, parents } = useMemo(() => {
    const byId = new Map(trace.spans.map((s) => [s.span_id, s]));
    const hidden = (parentId: string | null): boolean => {
      for (let p = parentId; p; p = byId.get(p)?.parent_span_id ?? null) if (collapsed.has(p)) return true;
      return false;
    };
    const all = flattenTree(buildSpanTree(trace.spans));
    const duration = trace.completedAt ? trace.completedAt - trace.startedAt : null;
    return {
      nodes: all.filter((n) => !hidden(n.span.parent_span_id)),
      totalMs: duration ?? Math.max(0, ...trace.spans.map((s) => s.end_ms ?? s.start_ms + (s.duration_ms ?? 0))),
      parents: new Set(trace.spans.map((s) => s.parent_span_id).filter((x): x is string => !!x)),
    };
  }, [trace, collapsed]);

  return (
    <div className="k-in flex flex-col gap-1" style={{ paddingBottom: 8 }}>
      <div style={GRID} className="typo-label k-quiet">
        <span />
        <span className="flex justify-between"><span>0</span><Numeric value={totalMs} unit="ms" /></span>
      </div>
      {nodes.map(({ span, depth }) => {
        const left = totalMs > 0 ? (span.start_ms / totalMs) * 100 : 0;
        const width = totalMs > 0 ? Math.max(((span.duration_ms ?? totalMs - span.start_ms) / totalMs) * 100, 0.5) : 100;
        const open = !collapsed.has(span.span_id);
        return (
          <div key={span.span_id} style={{ ...GRID, minHeight: 28 }}>
            <span className="flex items-center gap-2 min-w-0" style={{ paddingLeft: depth * 14 }}>
              {parents.has(span.span_id)
                ? <KitButton quiet expanded={open} onClick={() => toggle(span.span_id)}>{open ? '-' : '+'}</KitButton>
                : <Dot tone={span.error ? 'error' : 'primary'} glyph={span.error ? 'solid' : 'soft'} />}
              <span className="typo-label k-quiet">{getSpanConfig(span.span_type).label}</span>
              <span className="typo-code k-ellipsis">{span.name}</span>
            </span>
            <span className="relative block" style={{ height: 12 }}>
              <span
                className="absolute rounded-interactive"
                style={{ left: `${left}%`, width: `${width}%`, minWidth: 2, top: 2, bottom: 2, background: toneColor(span.error ? 'error' : 'primary'), opacity: 0.55 }}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}
