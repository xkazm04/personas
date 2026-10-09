/**
 * The gate rows' sort and filter, pure, plus the per-step memory of the
 * reader's choice (module scope: a walk to another step and back keeps it;
 * a reload starts from pipeline order and every command).
 *
 * Every judgement here is about the run a row SHOWS: the latest, or the
 * picked past Measure's while the page is time travelling, so "Failing" lists
 * the rows whose shown pill says so.
 */
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';

import type { CommandRow } from '../gateModel';
import { signalsOf, type CommandSignals } from './signals';

export type GateSort = 'pipeline' | 'slowest' | 'least_reliable';
export type GateFilter = 'all' | 'failing' | 'over_budget' | 'flaky';

export const GATE_SORTS: readonly GateSort[] = ['pipeline', 'slowest', 'least_reliable'];
export const GATE_FILTERS: readonly GateFilter[] = ['all', 'failing', 'over_budget', 'flaky'];

export interface GateViewState {
  sort: GateSort;
  filter: GateFilter;
}

export const DEFAULT_VIEW: GateViewState = { sort: 'pipeline', filter: 'all' };

/** A command row with what the screen derives for it. */
export interface InstrumentRow extends CommandRow {
  signals: CommandSignals;
  /** The run the row shows: the latest, or the picked Measure's (null when the command did not run in it). */
  shown: LifecycleRun | null;
  /** Position in pipeline order, for the stable sort. */
  order: number;
}

export function shownRun(row: CommandRow, measureId: string | null): LifecycleRun | null {
  return measureId ? row.runs.find((r) => r.measureId === measureId) ?? null : row.latest;
}

function ranToExit(r: LifecycleRun | null): r is LifecycleRun {
  return !!r && (r.outcome === 'passed' || r.outcome === 'failed');
}

/** Each command row with its signals, its shown run and its pipeline position. */
export function instrumentRows(rows: CommandRow[], related: LifecycleRelatedItem[], measureId: string | null): InstrumentRow[] {
  return rows.map((r, order) => ({ ...r, order, shown: shownRun(r, measureId), signals: signalsOf(r.runs, related, r.commandId) }));
}

/** The shown run failed or was stopped at its timeout. */
export function isFailing(row: InstrumentRow): boolean {
  return row.shown?.outcome === 'failed' || row.shown?.outcome === 'timeout';
}

/** The shown run answered and took longer than the command's budget. */
export function isOverBudget(row: InstrumentRow): boolean {
  return ranToExit(row.shown) && row.budgetMs != null && row.shown.durationMs > row.budgetMs;
}

export function matches(row: InstrumentRow, filter: GateFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'failing': return isFailing(row);
    case 'over_budget': return isOverBudget(row);
    case 'flaky': return row.signals.flaky !== null;
  }
}

/**
 * What the shown run cost in time, for 'slowest first': an answered run's
 * duration; a timeout's kill time, since it ran at least that long; -1 for a
 * run that never started or no run at all (sorted last).
 */
function shownCost(row: InstrumentRow): number {
  const run = row.shown;
  return run && run.outcome !== 'did_not_run' ? run.durationMs : -1;
}

/** Reliability, lower = less reliable: the pass rate, a flaky command a step below its rate; no answer sorts last. */
function reliability(row: InstrumentRow): number {
  if (row.passRate == null) return Number.POSITIVE_INFINITY;
  return row.passRate - (row.signals.flaky ? 0.5 : 0);
}

export function sortRows(rows: InstrumentRow[], sort: GateSort): InstrumentRow[] {
  const byOrder = (a: InstrumentRow, b: InstrumentRow) => a.order - b.order;
  const out = [...rows];
  if (sort === 'pipeline') return out.sort(byOrder);
  if (sort === 'slowest') return out.sort((a, b) => shownCost(b) - shownCost(a) || byOrder(a, b));
  return out.sort((a, b) => reliability(a) - reliability(b) || byOrder(a, b));
}

export function viewRows(rows: InstrumentRow[], view: GateViewState): InstrumentRow[] {
  return sortRows(rows.filter((r) => matches(r, view.filter)), view.sort);
}

export function filterCounts(rows: InstrumentRow[]): Record<GateFilter, number> {
  const out = { all: 0, failing: 0, over_budget: 0, flaky: 0 } as Record<GateFilter, number>;
  for (const f of GATE_FILTERS) out[f] = rows.filter((r) => matches(r, f)).length;
  return out;
}

// One entry per command-running step (gate, tests); the cap names the bound.
const memory = createModuleCache<string, GateViewState>({ maxSize: 8 });

export function rememberedView(stepId: string): GateViewState {
  return memory.get(stepId) ?? DEFAULT_VIEW;
}

export function rememberView(stepId: string, view: GateViewState): void {
  memory.set(stepId, view);
}

/** Test-only: forget every step's choice. */
export function __resetGateViewForTests(): void {
  memory.clear();
}
