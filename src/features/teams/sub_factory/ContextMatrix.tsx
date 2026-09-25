// L2 KPI matrix, composed from the kit (Gate 5). One level-2 Section per
// context group (its domain, a Dot legend of its KPI states and its rollup
// score in the meta; "KPIs" opens the group's table, L3), over a DataTable:
// one row per context, one column per KPI category, and a score column. A
// row's Mark is its rollup health; a row click opens that context's table. Each
// KPI in a cell is a button (its sparkline and value, in its status tone) that
// opens its console (L4). Only the 'spark' cell look is routed (TrendVariant);
// the unrouted 'chip' and 'heat' looks were dropped with the port.
import type { MouseEvent } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { DataTable, Dot, KitButton, Meta, Section, toneColor, type TableRow } from '@/features/shared/components/kit';
import {
  KPI_CATEGORIES,
  CATEGORY_LABEL,
  DOMAIN_LABEL,
  kpiStatus,
  rollup,
  contextKpis,
  groupKpis,
  type KpiStatus,
  type MockKpi,
  type MockProject,
} from './factoryModel';
import { Sparkline } from './factoryPrimitives';
import { healthMark, KPI_STATUS_MARK } from './factoryTone';
import { useFactoryWords, type FactoryWords } from './useFactoryWords';

type Col = 'context' | 'technical' | 'quality' | 'traffic' | 'value' | 'score';
const TALLY: KpiStatus[] = ['crit', 'warn', 'ok', 'unmeasured'];
const CELL_MIN = 112;

export type MatrixCellStyle = 'spark';

function Tally({ kpis, w }: { kpis: MockKpi[]; w: FactoryWords }) {
  const n: Record<KpiStatus, number> = { met: 0, ok: 0, warn: 0, crit: 0, unmeasured: 0 };
  for (const k of kpis) n[kpiStatus(k) === 'met' ? 'ok' : kpiStatus(k)] += 1;
  return (
    <span className="k-legend-row">
      {TALLY.filter((s) => n[s] > 0).map((s) => (
        <span key={s}><Dot {...KPI_STATUS_MARK[s]} /> {n[s]} {w.status[s].toLowerCase()}</span>
      ))}
    </span>
  );
}

function CellKpi({ kpi, onOpen }: { kpi: MockKpi; onOpen: (id: string) => void }) {
  const tone = KPI_STATUS_MARK[kpiStatus(kpi)].tone;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="k-btn k-btn--quiet typo-label k-regular"
      aria-label={`${kpi.name}: ${kpi.current ?? '-'} / ${kpi.target}${kpi.unit}`}
      data-testid={`factory-open-kpi-${kpi.id}`}
      // The row opens the context's table; this opens the KPI's console instead.
      onClick={(e: MouseEvent) => { e.stopPropagation(); onOpen(kpi.id); }}
    >
      <span className="inline-flex items-center gap-2">
        {kpi.series.length > 1 && <Sparkline series={kpi.series} color={toneColor(tone)} width={40} height={12} />}
        <span className="typo-data k-regular">{kpi.current ?? '-'}</span>
      </span>
    </Button>
  );
}

export function ContextMatrix({ project, ed, openKpi, openGroup }: {
  project: MockProject;
  ed: (k: MockKpi) => MockKpi;
  openKpi: (groupId: string, kpiId: string) => void;
  openGroup: (groupId: string, contextId: string | null) => void;
  cell?: MatrixCellStyle;
}) {
  const w = useFactoryWords();
  const cols = [
    { key: 'context' as const, label: w.context },
    ...KPI_CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c], num: true })),
    { key: 'score' as const, label: w.L.score, num: true },
  ];
  return (
    <div data-testid="factory-matrix">
      {project.groups.map((g) => {
        const gk = groupKpis(g).map(ed);
        const gr = rollup(gk);
        const gm = healthMark(gr.health);
        const rows: Array<TableRow<Col>> = g.contexts.map((c) => {
          const ck = contextKpis(c).map(ed);
          const cr = rollup(ck);
          const cells: TableRow<Col>['cells'] = {
            context: <span className="k-row__name typo-body k-strong">{c.name}</span>,
            score: <span className={cr.health == null ? 'typo-data k-regular k-quiet' : 'typo-data k-regular'} style={{ display: 'inline-block', minWidth: 48 }}>{cr.health ?? '-'}</span>,
          };
          for (const cat of KPI_CATEGORIES) {
            const ks = ck.filter((k) => k.category === cat);
            // A fixed minimum width per category cell, so the columns of every
            // group's table line up down the page.
            cells[cat] = (
              <span className="inline-flex items-center justify-end gap-1" style={{ minWidth: CELL_MIN }}>
                {ks.length === 0
                  ? <span className="typo-data k-quiet">·</span>
                  : ks.map((k) => <CellKpi key={k.id} kpi={k} onOpen={(kid) => openKpi(g.id, kid)} />)}
              </span>
            );
          }
          return { id: c.id, mark: { ...healthMark(cr.health), label: `${w.L.score} ${cr.health ?? '-'}` }, cells };
        });
        return (
          <Section
            key={g.id}
            level={2}
            title={g.name}
            count={g.contexts.length}
            meta={<Meta parts={[DOMAIN_LABEL[g.domain], <Tally key="t" kpis={gk} w={w} />, <span key="s" className="inline-flex items-center gap-2"><Dot {...gm} />{w.L.score} {gr.health ?? '-'}</span>]} />}
            actions={<KitButton onClick={() => openGroup(g.id, null)} testId={`factory-open-group-${g.id}`}>{w.kpis}</KitButton>}
          >
            <DataTable<Col> label={g.name} cols={cols} rows={rows} empty={{ title: w.L.noContexts }} onRowClick={(id) => openGroup(g.id, id)} />
          </Section>
        );
      })}
    </div>
  );
}
