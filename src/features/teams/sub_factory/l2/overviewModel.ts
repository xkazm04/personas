// L2 Overview view model: one row per context with its measured dimensions
// (Sentry errors, LLM cost, worst KPI attainment) and its worst-wins kind.
// Moved unchanged from FactoryOverviewTab (R11 semantics) when the tab was
// composed from the kit; only the colour moved out (factoryTone).
import type { DevContext } from '@/lib/bindings/DevContext';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import { kpiTrack } from '@/features/teams/sub_kpis/kpiMath';
import type { DimTone, FocusKind } from '../factoryTone';
import type { FactoryL2Data } from './factoryL2Data';

export interface Cell {
  ctx: DevContext;
  errs: number | null;
  costUsd: number | null;
  kpiPct: number | null;
  dims: { errors: DimTone; cost: DimTone; kpi: DimTone };
  kind: FocusKind;
  kpiCount: number;
}

export interface CellGroup { id: string; name: string; cells: Cell[] }

function kpiAttainment(k: DevKpi): number | null {
  if (k.current_value == null || k.target_value == null) return null;
  if (k.target_value === 0 && k.direction !== 'down') return null;
  const pct =
    k.direction === 'down'
      ? (k.current_value === 0 ? 140 : (k.target_value / k.current_value) * 100)
      : (k.current_value / k.target_value) * 100;
  return Math.max(0, Math.min(140, Math.round(pct)));
}

export function buildCell(ctx: DevContext, data: FactoryL2Data, kpisByCtx: Map<string, DevKpi[]>): Cell {
  const errs = data.monitoringWired ? data.runtime.errorsByContext.get(ctx.id) ?? 0 : null;
  const costUsd = data.llmWired ? data.runtime.costByContext.get(ctx.id) ?? 0 : null;
  const ctxKpis = kpisByCtx.get(ctx.id) ?? [];

  let kpiTone: DimTone = 'unmeasured';
  let kpiPct: number | null = null;
  const tracks = ctxKpis.map((k) => ({ k, track: kpiTrack(k) })).filter((t) => t.track !== 'unmeasured');
  if (tracks.length > 0) {
    const off = tracks.some((t) => t.track === 'off-track');
    kpiTone = off ? 'crit' : 'ok';
    const pcts = tracks.map((t) => kpiAttainment(t.k)).filter((p): p is number => p !== null);
    if (pcts.length > 0) kpiPct = Math.min(...pcts);
    if (!off && kpiPct !== null && kpiPct < 100) kpiTone = 'warn';
  }

  const errTone: DimTone = errs === null ? 'unmeasured' : errs >= 25 ? 'crit' : errs > 0 ? 'warn' : 'ok';
  const costTone: DimTone = costUsd === null ? 'unmeasured' : costUsd >= 18 ? 'crit' : costUsd >= 6 ? 'warn' : 'ok';

  const dims = { errors: errTone, cost: costTone, kpi: kpiTone };
  const tones = Object.values(dims);
  const worst: DimTone =
    tones.includes('crit') ? 'crit'
    : tones.includes('warn') ? 'warn'
    : tones.every((t) => t === 'unmeasured') ? 'unmeasured'
    : 'ok';
  const kind: FocusKind =
    worst === 'crit' ? 'crit'
    : worst === 'warn' ? 'warn'
    : kpiTone === 'unmeasured' || worst === 'unmeasured' ? 'setup'
    : 'ok';

  return { ctx, errs, costUsd, kpiPct, dims, kind, kpiCount: ctxKpis.length };
}

/** Active KPIs per context. */
export function activeKpisByContext(kpis: DevKpi[]): Map<string, DevKpi[]> {
  const m = new Map<string, DevKpi[]>();
  for (const k of kpis) {
    if (!k.context_id || k.status !== 'active') continue;
    const list = m.get(k.context_id);
    if (list) list.push(k);
    else m.set(k.context_id, [k]);
  }
  return m;
}

/** Contexts grouped under their context group; ungrouped contexts last. */
export function groupCells(data: FactoryL2Data, ungroupedName: string): CellGroup[] {
  const kpisByCtx = activeKpisByContext(data.kpis);
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
  if (ungrouped.length > 0) named.push({ id: '__ungrouped', name: ungroupedName, cells: ungrouped });
  return named;
}

/** How many contexts are in each kind. */
export function kindCounts(cells: readonly Cell[]): Record<FocusKind, number> {
  const s: Record<FocusKind, number> = { crit: 0, warn: 0, setup: 0, ok: 0 };
  for (const c of cells) s[c.kind] += 1;
  return s;
}

/**
 * A context's coverage counts. Both maps are built from rows that loaded
 * (active use cases, the project's goals), so a context missing from one has
 * none of them among those rows; a failed goals read also lands here as zero,
 * which the old cards showed the same way.
 */
export function coverageOf(data: FactoryL2Data, ctxId: string): { features: number; goals: number; proposals: number } {
  return {
    features: data.featureCountByContext.get(ctxId) ?? 0,
    goals: data.goalCountByContext.get(ctxId) ?? 0,
    proposals: data.proposalsByContext.get(ctxId)?.length ?? 0,
  };
}
