// Factory L2 — tab (d) Overview. The cockpit prototype's FOCUS health grid
// (R6 winner) wired to REAL data: one plate per context, grouped by context
// group, four honest dimensions —
//   • KPI    — worst-wins rollup of the context's real KPIs (contextKpiStatus);
//              the divider IS the worst KPI's attainment line; no KPI = blue
//              dashed "define KPI" invitation.
//   • errors — unresolved Sentry events attributed to the context's files.
//   • cost   — 30d LLM spend flowing through the context (full cost of every
//              feature slicing it — see useContextRuntime ATTRIBUTION).
//   • wiring — an unwired sensor renders '·', never a fake zero.
// All-healthy plates RECEDE (title readable, the rest fades on a green wash);
// what stands is the work. Tooltips are element-anchored + body-portaled.
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CircleDollarSign, Wrench } from 'lucide-react';

import type { DevContext } from '@/lib/bindings/DevContext';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import { kpiTrack } from '@/features/teams/sub_kpis/kpiMath';

import { INK, anchorTip } from '../passport/passportInk';
import type { FactoryL2Data } from './factoryL2Data';

type Tone = 'crit' | 'warn' | 'ok' | 'unmeasured';
type FocusKind = 'crit' | 'warn' | 'setup' | 'ok';

const TONE_HUE: Record<Tone, string> = {
  crit: INK.red, warn: INK.amber, ok: INK.emerald, unmeasured: 'rgba(148,163,184,.45)',
};
const KIND_HUE: Record<FocusKind, string> = {
  crit: INK.red, warn: INK.amber, setup: INK.blue, ok: INK.emerald,
};

/** One context's real cell — the three dims + the numbers behind them. */
interface Cell {
  ctx: DevContext;
  errs: number | null;
  costUsd: number | null;
  /** Worst KPI's attainment vs target (0–140), null = no measured KPI. */
  kpiPct: number | null;
  dims: { errors: Tone; cost: Tone; kpi: Tone };
  kind: FocusKind;
  kpiCount: number;
}

/** Attainment of one KPI vs its target, honest about direction. */
function kpiAttainment(k: DevKpi): number | null {
  if (k.current_value == null || k.target_value == null) return null;
  if (k.target_value === 0 && k.direction !== 'down') return null;
  const pct =
    k.direction === 'down'
      ? (k.current_value === 0 ? 140 : (k.target_value / k.current_value) * 100)
      : (k.current_value / k.target_value) * 100;
  return Math.max(0, Math.min(140, Math.round(pct)));
}

function buildCell(ctx: DevContext, data: FactoryL2Data, kpisByCtx: Map<string, DevKpi[]>): Cell {
  const errs = data.monitoringWired ? data.runtime.errorsByContext.get(ctx.id) ?? 0 : null;
  const costUsd = data.llmWired ? data.runtime.costByContext.get(ctx.id) ?? 0 : null;
  const ctxKpis = kpisByCtx.get(ctx.id) ?? [];

  // Worst-wins KPI dim from the real tracks; attainment from the worst KPI.
  let kpiTone: Tone = 'unmeasured';
  let kpiPct: number | null = null;
  const tracks = ctxKpis.map((k) => ({ k, track: kpiTrack(k) })).filter((t) => t.track !== 'unmeasured');
  if (tracks.length > 0) {
    const off = tracks.some((t) => t.track === 'off-track');
    kpiTone = off ? 'crit' : 'ok';
    const pcts = tracks.map((t) => kpiAttainment(t.k)).filter((p): p is number => p !== null);
    if (pcts.length > 0) kpiPct = Math.min(...pcts);
    if (!off && kpiPct !== null && kpiPct < 100) kpiTone = 'warn';
  }

  const errTone: Tone = errs === null ? 'unmeasured' : errs >= 25 ? 'crit' : errs > 0 ? 'warn' : 'ok';
  const costTone: Tone = costUsd === null ? 'unmeasured' : costUsd >= 18 ? 'crit' : costUsd >= 6 ? 'warn' : 'ok';

  const dims = { errors: errTone, cost: costTone, kpi: kpiTone };
  const worst: Tone =
    Object.values(dims).includes('crit') ? 'crit'
    : Object.values(dims).includes('warn') ? 'warn'
    : Object.values(dims).every((t) => t === 'unmeasured') ? 'unmeasured'
    : 'ok';
  const kind: FocusKind =
    worst === 'crit' ? 'crit'
    : worst === 'warn' ? 'warn'
    : kpiTone === 'unmeasured' || worst === 'unmeasured' ? 'setup'
    : 'ok';

  return { ctx, errs, costUsd, kpiPct, dims, kind, kpiCount: ctxKpis.length };
}

function setupAsk(c: Cell): string {
  const noKpi = c.dims.kpi === 'unmeasured';
  const noSensor = c.errs === null || c.costUsd === null;
  if (noKpi && noSensor) return 'define KPI · wire sensors →';
  if (noKpi) return c.kpiCount > 0 ? 'measure KPI →' : 'define KPI →';
  return 'wire sensors →';
}

// -- KPI progress divider ----------------------------------------------------

function KpiLine({ c, faded }: { c: Cell; faded?: boolean }) {
  if (c.kpiPct === null) {
    return <span className="block my-1.5 border-t border-dashed" style={{ borderColor: `${INK.blue}66` }} title={c.kpiCount > 0 ? 'KPIs defined but not measured yet' : 'No KPI defined for this context'} />;
  }
  const hue = TONE_HUE[c.dims.kpi];
  return (
    <span className="block my-1.5 h-[2px] rounded-full relative" style={{ background: 'rgba(148,163,184,.10)' }} title={`Worst KPI at ${c.kpiPct}% of target`}>
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, c.kpiPct)}%`, background: hue, boxShadow: faded ? undefined : `0 0 4px ${hue}66` }} />
    </span>
  );
}

// -- the element-anchored tooltip ---------------------------------------------

interface TipState { cell: Cell; group: string; rect: DOMRect }

const FOCUS_SENTENCE: Record<FocusKind, (c: Cell) => string> = {
  crit: () => 'Needs attention now — a dimension is critical.',
  warn: () => 'Drifting — worth a look this week.',
  setup: (c) => `Unconfigured — ${setupAsk(c).replace(' →', '')}.`,
  ok: () => 'All clear. Nothing here needs you.',
};

function FocusTooltip({ tip }: { tip: TipState }) {
  const { cell, group } = tip;
  const hue = KIND_HUE[cell.kind];
  const { left, top } = anchorTip(tip.rect, 280, 200);
  const dim = (label: string, value: string | null, dimHue: string) => (
    <div className="min-w-0">
      <span className="block text-[10px] uppercase tracking-[0.12em] text-foreground/40">{label}</span>
      <span className="block typo-caption font-medium tabular-nums" style={{ color: value === null ? INK.blue : dimHue }}>
        {value ?? 'set up →'}
      </span>
    </div>
  );
  return createPortal(
    <div
      data-testid="factory-focus-tooltip"
      className="fixed z-50 w-[280px] pointer-events-none rounded-xl overflow-hidden"
      style={{
        left, top,
        background: 'color-mix(in srgb, var(--background) 88%, #1e293b)',
        border: `1px solid ${hue}44`,
        boxShadow: '0 16px 40px rgba(0,0,0,.45)',
      }}
    >
      <div className="px-4 pt-3 pb-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-foreground/40">{group}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="typo-body font-semibold text-foreground truncate">{cell.ctx.name}</span>
          <span className="ml-auto shrink-0 rounded-full px-2 py-[2px] text-[10px] font-medium tracking-wide" style={{ color: hue, border: `1px solid ${hue}55`, background: `${hue}14` }}>
            {cell.kind === 'setup' ? 'Setup needed' : cell.kind === 'ok' ? 'Healthy' : cell.kind === 'crit' ? 'Critical' : 'Warning'}
          </span>
        </div>
      </div>
      <div className="mx-4"><KpiLine c={cell} /></div>
      <div className="px-4 pb-2.5 pt-1 grid grid-cols-3 gap-x-3">
        {dim('Errors', cell.errs === null ? null : `${cell.errs} unresolved`, TONE_HUE[cell.dims.errors])}
        {dim('LLM cost', cell.costUsd === null ? null : `$${cell.costUsd.toFixed(0)} /30d`, TONE_HUE[cell.dims.cost])}
        {dim('KPI', cell.kpiPct === null ? null : `${cell.kpiPct}%`, TONE_HUE[cell.dims.kpi])}
      </div>
      <div className="px-4 pb-3 typo-caption" style={{ color: hue }}>
        {FOCUS_SENTENCE[cell.kind](cell)}
      </div>
    </div>,
    document.body,
  );
}

// -- the plate -----------------------------------------------------------------

function Plate({ cell, group, onHover, onLeave }: {
  cell: Cell; group: string;
  onHover: (t: TipState) => void; onLeave: () => void;
}) {
  const enter = (e: React.MouseEvent<HTMLDivElement>) =>
    onHover({ cell, group, rect: e.currentTarget.getBoundingClientRect() });

  const pair = (Icon: typeof AlertTriangle, v: string | null, dimHue: string) => (
    <span className="flex items-center gap-1 min-w-0" style={{ color: v === null ? INK.blue : dimHue }}>
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      <span className="text-[10.5px] font-medium tabular-nums truncate">{v ?? '·'}</span>
    </span>
  );

  if (cell.kind === 'ok') {
    return (
      <div
        className="text-left min-w-0 px-2.5 pt-1.5 pb-2 rounded-card relative transition-all hover:-translate-y-[1px]"
        style={{ background: 'rgba(52,211,153,.05)', border: '1px solid rgba(52,211,153,.10)' }}
        onMouseEnter={enter} onMouseLeave={onLeave}
      >
        <span className="typo-caption font-medium text-foreground/85 truncate block">{cell.ctx.name}</span>
        <span className="block opacity-30">
          <KpiLine c={cell} faded />
          <span className="flex items-center gap-2.5 min-w-0">
            {pair(AlertTriangle, cell.errs === null ? null : String(cell.errs), INK.emerald)}
            {pair(CircleDollarSign, cell.costUsd === null ? null : `$${cell.costUsd.toFixed(0)}`, INK.emerald)}
          </span>
        </span>
      </div>
    );
  }

  if (cell.kind === 'setup') {
    return (
      <div
        className="text-left min-w-0 px-2.5 pt-1.5 pb-2 rounded-card relative transition-all hover:-translate-y-[1px]"
        style={{ background: `${INK.blue}0a`, border: `1px dashed ${INK.blue}55` }}
        onMouseEnter={enter} onMouseLeave={onLeave}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Wrench className="w-3 h-3 shrink-0" style={{ color: INK.blue }} aria-hidden />
          <span className="typo-caption font-medium text-foreground/90 truncate">{cell.ctx.name}</span>
        </span>
        <KpiLine c={cell} />
        <span className="text-[10.5px] font-medium" style={{ color: INK.blue }}>{setupAsk(cell)}</span>
      </div>
    );
  }

  const hue = KIND_HUE[cell.kind];
  return (
    <div
      className="text-left min-w-0 px-2.5 pt-1.5 pb-2 rounded-card relative transition-all hover:-translate-y-[1px]"
      style={{
        background: 'rgba(148,163,184,.045)',
        border: `1px solid ${hue}${cell.kind === 'crit' ? '66' : '3d'}`,
        boxShadow: cell.kind === 'crit' ? `0 0 8px ${INK.red}22` : undefined,
      }}
      onMouseEnter={enter} onMouseLeave={onLeave}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: hue, boxShadow: `0 0 5px ${hue}88` }} />
        <span className="typo-caption font-medium text-foreground/90 truncate">{cell.ctx.name}</span>
      </span>
      <KpiLine c={cell} />
      <span className="flex items-center gap-2.5 min-w-0">
        {pair(AlertTriangle, cell.errs === null ? null : String(cell.errs), TONE_HUE[cell.dims.errors])}
        {pair(CircleDollarSign, cell.costUsd === null ? null : `$${cell.costUsd.toFixed(0)}`, TONE_HUE[cell.dims.cost])}
      </span>
    </div>
  );
}

// -- the grid -------------------------------------------------------------------

export function FactoryOverviewTab({ data }: { data: FactoryL2Data }) {
  const [tip, setTip] = useState<TipState | null>(null);

  const kpisByCtx = useMemo(() => {
    const m = new Map<string, DevKpi[]>();
    for (const k of data.kpis) {
      if (!k.context_id || k.status !== 'active') continue;
      const list = m.get(k.context_id);
      if (list) list.push(k);
      else m.set(k.context_id, [k]);
    }
    return m;
  }, [data.kpis]);

  const groups = useMemo(() => {
    const byGroup = new Map<string | null, DevContext[]>();
    for (const c of data.contexts) {
      const key = c.group_id ?? null;
      const list = byGroup.get(key);
      if (list) list.push(c);
      else byGroup.set(key, [c]);
    }
    const named = data.groups
      .map((g) => ({ id: g.id, name: g.name, cells: (byGroup.get(g.id) ?? []).map((c) => buildCell(c, data, kpisByCtx)) }))
      .filter((g) => g.cells.length > 0);
    const ungrouped = (byGroup.get(null) ?? []).map((c) => buildCell(c, data, kpisByCtx));
    if (ungrouped.length > 0) named.push({ id: '__ungrouped', name: 'Ungrouped', cells: ungrouped });
    return named;
  }, [data, kpisByCtx]);

  const summary = useMemo(() => {
    const s = { crit: 0, warn: 0, ok: 0, setup: 0, total: 0 };
    for (const g of groups) for (const c of g.cells) { s[c.kind] += 1; s.total += 1; }
    return s;
  }, [groups]);

  if (!data.loading && summary.total === 0) {
    return (
      <p className="typo-caption text-foreground/45 rounded-card border border-dashed border-foreground/15 px-3 py-5 text-center" data-testid="factory-overview-tab">
        No contexts scanned yet — run a codebase scan from Dev Tools → Context Map to light this grid.
      </p>
    );
  }

  return (
    <div className="relative" data-testid="factory-overview-tab" onMouseLeave={() => setTip(null)}>
      <div className="typo-caption tabular-nums mb-3 flex items-center gap-2.5">
        <span className="text-foreground/40">{summary.total} contexts</span>
        {summary.crit > 0 && <span style={{ color: INK.red }}>● {summary.crit} critical</span>}
        {summary.warn > 0 && <span style={{ color: INK.amber }}>● {summary.warn} warning</span>}
        {summary.setup > 0 && <span style={{ color: INK.blue }}>◌ {summary.setup} setup</span>}
        <span style={{ color: INK.emerald }}>● {summary.ok} healthy</span>
        {!data.llmWired && <span className="text-foreground/35 ml-auto">LLM tracking unwired — cost dim dark</span>}
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
        {groups.map((g) => {
          const kinds = g.cells.map((c) => c.kind);
          const crit = kinds.filter((k) => k === 'crit').length;
          const warn = kinds.filter((k) => k === 'warn').length;
          const setup = kinds.filter((k) => k === 'setup').length;
          const worst: FocusKind = crit > 0 ? 'crit' : warn > 0 ? 'warn' : setup === g.cells.length ? 'setup' : 'ok';
          return (
            <div key={g.id} className="rounded-modal p-3" style={{ border: `1px solid ${KIND_HUE[worst]}2e`, background: 'rgba(148,163,184,.025)' }}>
              <div className="flex items-baseline gap-2 mb-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full shrink-0 self-center" style={{ background: KIND_HUE[worst], boxShadow: `0 0 5px ${KIND_HUE[worst]}88` }} />
                <h3 className="typo-caption font-semibold tracking-tight text-foreground/85 truncate">{g.name}</h3>
                <span className="ml-auto text-[10px] tabular-nums shrink-0 flex items-center gap-2">
                  {crit > 0 && <span style={{ color: INK.red }}>{crit} critical</span>}
                  {warn > 0 && <span style={{ color: INK.amber }}>{warn} warning</span>}
                  {setup > 0 && <span style={{ color: INK.blue }}>{setup} setup</span>}
                  <span className="text-foreground/30">{g.cells.length}</span>
                </span>
              </div>
              <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
                {g.cells.map((c) => <Plate key={c.ctx.id} cell={c} group={g.name} onHover={setTip} onLeave={() => setTip(null)} />)}
              </div>
            </div>
          );
        })}
      </div>
      {tip && <FocusTooltip tip={tip} />}
    </div>
  );
}
