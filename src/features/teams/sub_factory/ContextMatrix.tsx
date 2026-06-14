// L2 — the sophisticated context × KPI matrix (round-4).
//   · one row  = one context (contexts wrapped into context-group sections)
//   · one col  = one KPI category (Technical / Quality / Traffic / Value)
//   · one cell = that context's KPI(s) of that category, very compact
// So every context's KPIs sit on a single dense row (comfortably ~5 across).
// Parameterised by `cell` so the three round-4 variants explore the cell look:
//   'chip' (status chip + value) · 'heat' (filled tile) · 'spark' (trendline).
// Click a cell's KPI → its console; click a context/group name → its table.
import {
  KPI_CATEGORIES,
  CATEGORY_LABEL,
  DOMAIN_LABEL,
  STATUS_COLOR,
  kpiStatus,
  rollup,
  contextKpis,
  groupKpis,
  type MockKpi,
  type MockProject,
} from './factoryMock';
import { Sparkline, TrafficTally } from './factoryPrimitives';

const COLS = 'minmax(140px,1.5fr) repeat(4, minmax(76px,1fr)) 46px';
const hc = (v: number) => (v >= 70 ? STATUS_COLOR.met : v >= 40 ? STATUS_COLOR.warn : STATUS_COLOR.crit);

export type MatrixCellStyle = 'chip' | 'heat' | 'spark';

export function ContextMatrix({
  project,
  ed,
  openKpi,
  openGroup,
  cell,
}: {
  project: MockProject;
  ed: (k: MockKpi) => MockKpi;
  openKpi: (groupId: string, kpiId: string) => void;
  openGroup: (groupId: string, contextId: string | null) => void;
  cell: MatrixCellStyle;
}) {
  return (
    <div className="rounded-card border border-primary/10 overflow-hidden">
      {/* column header */}
      <div className="grid items-center gap-2 px-3 py-2 bg-secondary/20 border-b border-primary/10" style={{ gridTemplateColumns: COLS }}>
        <span className="typo-label text-foreground/60">Context</span>
        {KPI_CATEGORIES.map((c) => (
          <span key={c} className="typo-label text-foreground/50 text-center truncate">{CATEGORY_LABEL[c]}</span>
        ))}
        <span className="typo-label text-foreground/50 text-right">Score</span>
      </div>

      {project.groups.map((g) => {
        const gr = rollup(groupKpis(g).map(ed));
        return (
          <div key={g.id}>
            {/* group section band — click to open the group's KPI table */}
            <button type="button" onClick={() => openGroup(g.id, null)} className="w-full flex items-center gap-2 px-3 py-1.5 bg-secondary/10 hover:bg-secondary/25 transition-colors border-b border-primary/5 text-left">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: g.color }} />
              <span className="typo-title">{g.name}</span>
              <span className="typo-caption">{DOMAIN_LABEL[g.domain]}</span>
              <span className="flex-1" />
              <TrafficTally kpis={groupKpis(g).map(ed)} size={6} />
              <span className="typo-data tabular-nums ml-2 w-7 text-right" style={{ color: hc(gr.health) }}>{gr.health}</span>
            </button>

            {/* one row per context */}
            <div className="divide-y divide-primary/5">
              {g.contexts.map((c) => {
                const ck = contextKpis(c).map(ed);
                const cr = rollup(ck);
                return (
                  <div key={c.id} className="grid items-stretch gap-2 px-3 py-1 hover:bg-secondary/10 transition-colors" style={{ gridTemplateColumns: COLS }}>
                    <button type="button" onClick={() => openGroup(g.id, c.id)} className="typo-title truncate text-left hover:text-primary self-center">{c.name}</button>
                    {KPI_CATEGORIES.map((cat) => (
                      <MatrixCell key={cat} kpis={ck.filter((k) => k.category === cat)} cell={cell} onOpen={(kid) => openKpi(g.id, kid)} />
                    ))}
                    <span className="typo-data tabular-nums text-right self-center" style={{ color: hc(cr.health) }}>{cr.health}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MatrixCell({ kpis, cell, onOpen }: { kpis: MockKpi[]; cell: MatrixCellStyle; onOpen: (id: string) => void }) {
  if (kpis.length === 0) return <span className="flex items-center justify-center typo-caption text-foreground/25">·</span>;
  return (
    <span className="flex flex-wrap items-center justify-center gap-1 py-0.5">
      {kpis.map((k) => <CellKpi key={k.id} kpi={k} cell={cell} onOpen={onOpen} />)}
    </span>
  );
}

function CellKpi({ kpi, cell, onOpen }: { kpi: MockKpi; cell: MatrixCellStyle; onOpen: (id: string) => void }) {
  const color = STATUS_COLOR[kpiStatus(kpi)];
  const label = `${kpi.name}: ${kpi.current ?? '—'} / ${kpi.target}${kpi.unit}`;
  if (cell === 'heat') {
    return (
      <button
        type="button"
        onClick={() => onOpen(kpi.id)}
        title={label}
        className="rounded px-1.5 py-1 min-w-[2.4rem] text-center transition-transform hover:scale-105"
        style={{ background: `color-mix(in srgb, ${color} 28%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 55%, transparent)` }}
      >
        <span className="typo-data tabular-nums" style={{ color }}>{kpi.current ?? '—'}</span>
      </button>
    );
  }
  if (cell === 'spark') {
    return (
      <button type="button" onClick={() => onOpen(kpi.id)} title={label} className="flex flex-col items-center rounded px-1 py-0.5 hover:bg-secondary/30 transition-colors">
        <Sparkline series={kpi.series} color={color} width={40} height={12} />
        <span className="typo-caption tabular-nums" style={{ color }}>{kpi.current ?? '—'}</span>
      </button>
    );
  }
  // chip
  return (
    <button
      type="button"
      onClick={() => onOpen(kpi.id)}
      title={label}
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 hover:scale-105 transition-transform"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="typo-caption tabular-nums" style={{ color }}>{kpi.current ?? '—'}</span>
    </button>
  );
}
