// L2 Overview (composition kit): one context group as a level-2 Section over a
// DataTable. It replaces the group card and its grid of context cards: every
// context is a row whose Mark is its worst dimension (FOCUS_MARK), its figures
// line up in columns (features, goals, proposed KPIs, worst KPI drawn as pips of
// 10% of target, Sentry errors, 30-day LLM cost), and a click selects it for
// the detail pane (the proposals hover tooltip's job, now a pane).
import type { ReactNode } from 'react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { DataTable, Dot, Meta, Section, UnitStrip, type TableRow } from '@/features/shared/components/kit';
import { DIM_TONE, FOCUS_MARK, type FocusKind } from '../factoryTone';
import type { FactoryWords } from '../useFactoryWords';
import type { FactoryL2Data } from './factoryL2Data';
import { coverageOf, kindCounts, type Cell, type CellGroup } from './overviewModel';

type Col = 'context' | 'features' | 'goals' | 'proposed' | 'kpi' | 'errors' | 'cost';
const ORDER: FocusKind[] = ['crit', 'warn', 'setup', 'ok'];

/** Kind counts as a legend of Dots, worst first; zero kinds are left out. */
export function KindLegend({ cells, w }: { cells: readonly Cell[]; w: FactoryWords }) {
  const n = kindCounts(cells);
  return (
    <span className="k-legend-row">
      {ORDER.filter((k) => n[k] > 0).map((k) => (
        <span key={k}><Dot {...FOCUS_MARK[k]} /> {n[k]} {w.kind[k].toLowerCase()}</span>
      ))}
    </span>
  );
}

const fig = (v: number) => <span className={v === 0 ? 'typo-data k-regular k-quiet' : 'typo-data k-regular'}>{v}</span>;
const dash = <span className="typo-data k-regular k-quiet">-</span>;

function kpiCell(c: Cell, w: FactoryWords) {
  if (c.kpiPct == null) return dash;
  return (
    <span className="k-fig">
      <UnitStrip size="pip" label={w.L.worstKpi} segments={[{ n: Math.min(10, c.kpiPct / 10), tone: DIM_TONE[c.dims.kpi] }]} />
      <span className="typo-data k-regular">{c.kpiPct}%</span>
    </span>
  );
}

/** A figure in its dimension's tone when it is a problem; plain when fine. */
function toned(v: number | null, dim: Cell['dims']['errors'], node: (v: number) => ReactNode) {
  if (v == null) return dash;
  const cls = dim === 'crit' || dim === 'warn' ? `t-${DIM_TONE[dim]} k-toned` : v === 0 ? 'k-quiet' : undefined;
  return <span className={`typo-data k-regular ${cls ?? ''}`}>{node(v)}</span>;
}

export function FactoryContextGroup({ group, data, selected, onSelect, w }: {
  group: CellGroup;
  data: FactoryL2Data;
  selected: string | null;
  onSelect: (id: string) => void;
  w: FactoryWords;
}) {
  const rows: Array<TableRow<Col>> = group.cells.map((c) => {
    const { features, goals, proposals } = coverageOf(data, c.ctx.id);
    const states = [c.ctx.id === selected ? 'selected' : null, c.kind === 'ok' ? 'muted' : null].filter((s): s is 'selected' | 'muted' => s != null);
    return {
      id: c.ctx.id,
      mark: { ...FOCUS_MARK[c.kind], label: w.kind[c.kind] },
      state: states,
      cells: {
        context: (
          <div className="k-cell2">
            <span className="k-row__name typo-body k-strong">{c.ctx.business_feature?.trim() || c.ctx.name}</span>
            <span className="k-row__meta typo-caption">
              <Meta parts={[c.ctx.category, c.kind === 'setup' && c.kpiCount === 0 ? w.t.kpis.define_kpi : `${c.kpiCount} ${w.L.kpisCount}`]} />
            </span>
          </div>
        ),
        features: fig(features),
        goals: fig(goals),
        proposed: proposals > 0 ? <span className="typo-data k-regular t-agent k-toned">{proposals}</span> : fig(0),
        kpi: kpiCell(c, w),
        errors: toned(c.errs, c.dims.errors, (v) => v),
        cost: toned(c.costUsd, c.dims.cost, (v) => <Numeric value={v} unit="usd" precision={0} />),
      },
    };
  });
  return (
    <Section level={2} title={group.name} count={group.cells.length} meta={<KindLegend cells={group.cells} w={w} />}>
      <DataTable<Col>
        label={group.name}
        cols={[
          { key: 'context', label: w.context },
          { key: 'features', label: w.features, num: true },
          { key: 'goals', label: w.goals, num: true },
          { key: 'proposed', label: w.L.proposed, num: true },
          { key: 'kpi', label: w.L.worstKpi, num: true },
          { key: 'errors', label: w.errors, num: true },
          { key: 'cost', label: w.cost, num: true },
        ]}
        rows={rows}
        empty={{ title: w.L.noContexts }}
        onRowClick={onSelect}
        rowTestId="factory-context-row"
      />
    </Section>
  );
}
