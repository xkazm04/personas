// L3: a group's KPIs as a kit DataTable, one KPI per row, worst first so
// attention lands on top. A row's Mark is its calibrated band (KPI_STATUS_MARK),
// so the trailing status pill is gone; progress from baseline to target is
// drawn as pips of 10%; the trend is the KPI's sparkline in its band's tone. A
// row click opens the KPI's console (L4).
//
// The old head could reverse the order (best first). The kit DataTable has no
// sortable columns yet (a sibling is adding them), so the order is fixed; see
// the Gate 5 kit gaps.
import { DataTable, Meta, toneColor, UnitStrip, type TableRow } from '@/features/shared/components/kit';
import { CATEGORY_LABEL, fmtUnit, kpiStatus, progressPct, type KpiStatus, type MockKpi } from './factoryModel';
import { Sparkline } from './factoryPrimitives';
import { KPI_STATUS_MARK } from './factoryTone';
import type { FactoryWords } from './useFactoryWords';

const SEV: Record<KpiStatus, number> = { crit: 0, warn: 1, ok: 2, met: 3, unmeasured: 4 };
type Col = 'kpi' | 'rating' | 'value' | 'trend';

export function KpiTable({ kpis, onOpen, w, withContext = true }: {
  kpis: Array<{ kpi: MockKpi; contextName: string }>;
  onOpen: (id: string) => void;
  w: FactoryWords;
  withContext?: boolean;
}) {
  const sorted = [...kpis].sort((a, b) => SEV[kpiStatus(a.kpi)] - SEV[kpiStatus(b.kpi)]);
  const rows: Array<TableRow<Col>> = sorted.map(({ kpi, contextName }) => {
    const st = kpiStatus(kpi);
    const mark = KPI_STATUS_MARK[st];
    const pct = progressPct(kpi);
    return {
      id: kpi.id,
      mark: { ...mark, label: w.status[st] },
      state: st === 'unmeasured' ? 'muted' : undefined,
      cells: {
        kpi: (
          <div className="k-cell2">
            <span className="k-row__name typo-body k-strong">{kpi.name}</span>
            <span className="k-row__meta typo-caption"><Meta parts={[withContext ? contextName : null, CATEGORY_LABEL[kpi.category]]} /></span>
          </div>
        ),
        rating: pct == null ? <span className="typo-data k-quiet">-</span> : (
          <span className="k-fig">
            <UnitStrip size="pip" label={w.L.rating} segments={[{ n: pct / 10, tone: mark.tone }, { n: 10 - pct / 10, tone: 'neutral', glyph: 'empty' }]} />
            <span className="typo-data k-regular">{pct}%</span>
          </span>
        ),
        value: (
          <span className="typo-data k-regular">
            {kpi.current ?? '-'}<span className="k-quiet"> / {fmtUnit(kpi.target, kpi.unit)}</span>
          </span>
        ),
        trend: <Sparkline series={kpi.series} color={toneColor(mark.tone)} width={56} height={16} />,
      },
    };
  });
  return (
    <DataTable<Col>
      label={w.kpis}
      cols={[
        { key: 'kpi', label: w.kpi },
        { key: 'rating', label: w.L.rating, num: true },
        { key: 'value', label: w.L.value, num: true },
        { key: 'trend', label: w.trend, num: true },
      ]}
      rows={rows}
      empty={{ title: w.t.kpis.rollup_no_kpis_here }}
      onRowClick={onOpen}
      rowTestId="factory-kpi-row"
    />
  );
}
