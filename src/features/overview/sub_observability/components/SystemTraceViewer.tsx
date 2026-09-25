/**
 * Observability (composition kit): the system trace timeline. Traces are a DataTable (a trace's
 * Mark: error, live while in flight, done); the operation filter is a Segmented and Clear a
 * KitButton in the Toolbar. Picking a trace opens its span waterfall in a level-2 Section.
 */
import { useMemo, useState } from 'react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { DataTable, KitButton, Meta, Section, Segmented, Toolbar, type TableRow, type KitState } from '@/features/shared/components/kit';
import { useSystemTraces } from '@/hooks/execution/useSystemTrace';
import { SYSTEM_OPERATION_CONFIG } from '@/features/agents/sub_executions/libs/traceHelpers';
import type { SystemOperationType } from '@/lib/execution/pipeline';
import { useTranslation } from '@/i18n/useTranslation';
import { SystemTraceWaterfall } from './SystemTraceWaterfall';

type Col = 'trace' | 'spans' | 'dur' | 'at';
const opLabel = (op: SystemOperationType) => SYSTEM_OPERATION_CONFIG[op]?.label ?? op;

export default function SystemTraceViewer({ eyebrow }: { eyebrow?: string }) {
  const { t } = useTranslation();
  const st = t.overview.system_trace_extra;
  const { traces, activeCount, errorCount, clear } = useSystemTraces();
  const [filter, setFilter] = useState<SystemOperationType | 'all'>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const ops = useMemo(() => [...new Set(traces.map((x) => x.operationType))].sort(), [traces]);
  const shown = useMemo(() => (filter === 'all' ? traces : traces.filter((x) => x.operationType === filter)), [traces, filter]);
  const selected = traces.find((x) => x.traceId === picked) ?? null;

  const rows: Array<TableRow<Col>> = shown.map((trace) => {
    const errored = trace.spans.some((s) => s.error);
    const live = !trace.completedAt;
    const state: KitState[] = [];
    if (trace.traceId === picked) state.push('selected');
    if (live) state.push('live');
    return {
      id: trace.traceId,
      state,
      mark: errored ? { tone: 'error', glyph: 'solid', label: t.common.error } : live ? { tone: 'primary', glyph: 'live', label: t.common.active } : { tone: 'success', glyph: 'hollow', label: opLabel(trace.operationType) },
      cells: {
        trace: (
          <div className="k-cell2">
            <span className="k-row__name typo-code k-strong">{trace.label}</span>
            <span className="k-row__meta typo-caption"><Meta parts={[opLabel(trace.operationType), live ? t.common.active : null]} /></span>
          </div>
        ),
        spans: <span className="typo-data k-regular">{trace.spans.length}</span>,
        dur: <span className="typo-data k-regular">{trace.completedAt ? <Numeric value={trace.completedAt - trace.startedAt} unit="ms" /> : <span className="k-quiet">-</span>}</span>,
        at: <span className="typo-data k-regular k-quiet"><AbsoluteTime timestamp={trace.startedAt} variant="time" /></span>,
      },
    };
  });

  return (
    <Section
      id="s-obs-trace"
      eyebrow={eyebrow}
      title={t.overview.observability_extra.system_trace}
      count={traces.length || undefined}
      meta={traces.length > 0 ? <Meta parts={[activeCount > 0 ? `${activeCount} ${t.common.active.toLowerCase()}` : null, errorCount > 0 ? `${errorCount} ${t.common.error.toLowerCase()}` : null]} /> : undefined}
      state={traces.length === 0 ? 'empty' : undefined}
      empty={{ title: st.no_traces, hint: st.no_traces_hint }}
    >
      <Toolbar label={t.overview.observability_extra.system_trace}>
        {ops.length > 1 && (
          <Segmented<SystemOperationType | 'all'>
            label={st.all_operations}
            value={filter}
            onChange={setFilter}
            options={[{ v: 'all', label: st.all_operations, count: traces.length }, ...ops.map((op) => ({ v: op, label: opLabel(op), count: traces.filter((x) => x.operationType === op).length }))]}
          />
        )}
        <KitButton quiet onClick={clear}>{st.clear_completed}</KitButton>
      </Toolbar>
      <DataTable<Col>
        label={t.overview.observability_extra.system_trace}
        onRowClick={(id) => setPicked((cur) => (cur === id ? null : id))}
        cols={[
          { key: 'trace', label: t.agents.executions.trace },
          { key: 'spans', label: '#', num: true },
          { key: 'dur', label: t.overview.ipc_panel.duration_header, num: true },
          { key: 'at', label: t.overview.ipc_panel.when_header, num: true },
        ]}
        rows={rows}
        empty={{ title: st.no_traces }}
      />
      {selected && (
        <Section level={2} title={selected.label} meta={opLabel(selected.operationType)}>
          <SystemTraceWaterfall trace={selected} />
        </Section>
      )}
    </Section>
  );
}
