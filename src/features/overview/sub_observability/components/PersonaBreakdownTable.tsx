/**
 * Observability (composition kit): executions by persona as a DataTable. The pie it replaces
 * clipped persona names at the panel edge; here each persona is a row, its runs drawn as units
 * of a shared quantum (stated in the pager) and its cost in a column beside them.
 */
import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { DataTable, Section, UnitStrip, quantumFor, type TableRow } from '@/features/shared/components/kit';
import type { PieDataPoint } from './MetricsCharts';

type Col = 'persona' | 'runs' | 'cost';

export function PersonaBreakdownTable({ rows, loading }: { rows: PieDataPoint[]; loading?: boolean }) {
  const { t } = useTranslation();
  const o = t.overview;
  const sorted = useMemo(() => [...rows].sort((a, b) => b.executions - a.executions), [rows]);
  const total = sorted.reduce((a, r) => a + r.executions, 0);
  const q = quantumFor(sorted[0]?.executions ?? 0, 40, 1);
  const table: Array<TableRow<Col>> = sorted.map((r) => ({
    id: r.name,
    mark: { tone: 'agent', glyph: 'soft', label: r.name },
    cells: {
      persona: (
        <div className="k-cell2">
          <span className="k-row__name typo-body k-strong">{r.name}</span>
          <span className="k-row__meta typo-caption"><Numeric value={total > 0 ? r.executions / total : 0} unit="ratio" precision={0} /></span>
        </div>
      ),
      runs: (
        <span className="k-fig">
          <UnitStrip size="pip" label={o.observability_extra.executions_label} segments={[{ n: r.executions / q, tone: 'agent', glyph: 'soft' }]} />
          <span className="typo-data k-regular"><Numeric value={r.executions} unit="count" /></span>
        </span>
      ),
      cost: <span className="typo-data k-regular"><Numeric value={r.cost} unit="usd" /></span>,
    },
  }));
  return (
    <Section id="s-obs-personas" title={o.observability_charts.executions_by_persona} count={sorted.length}>
      <DataTable<Col>
        label={o.observability_charts.executions_by_persona}
        loading={loading && sorted.length === 0}
        cols={[
          { key: 'persona', label: o.events.col_persona },
          { key: 'runs', label: o.observability_extra.executions_label, num: true },
          { key: 'cost', label: o.activity.col_cost, num: true },
        ]}
        rows={table}
        empty={{ title: o.analytics_dashboard.no_execution_data }}
        pager={sorted.length > 0 ? (
          <span className="typo-caption k-legend-row">
            <span>{o.observability_extra.executions_label} <UnitStrip size="pip" label={o.observability_extra.executions_label} segments={[{ n: 1, tone: 'agent', glyph: 'soft' }]} /> = {q}</span>
          </span>
        ) : undefined}
      />
    </Section>
  );
}
