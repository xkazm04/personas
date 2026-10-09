/**
 * Pure model behind the Measure history: the columns in drawing order, one
 * step's cell at one Measure as a health row the rail already knows how to
 * draw, and the change between a Measure and the one before it. No React, no
 * i18n, no IO.
 *
 * Conventions this file owns:
 *
 * 1. DRAWING ORDER. The backend sends the newest Measure first; every view
 *    draws oldest left, newest right. `timeline` is the one place that flips it.
 * 2. A CELL IS A HEALTH ROW. A past Measure's cell becomes the same
 *    `LifecycleStepHealthView` the snapshot carries, with the Measure before it
 *    as its `previous`. So the rail, its deltas and its peek draw a travelled
 *    step with the code that draws it now, and "what changed" is computed by
 *    the rail's own delta helper (`layer1/delta`), never a second copy.
 * 3. THE NEWEST MEASURE IS NOW. Travelling to it is returning to the
 *    snapshot; only an older Measure is ever "viewed".
 */
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import type { LifecycleHistory } from '@/lib/bindings/LifecycleHistory';
import type { LifecycleHistoryCell } from '@/lib/bindings/LifecycleHistoryCell';
import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';
import type { LifecycleStepHealthView } from '@/lib/bindings/LifecycleStepHealthView';

import { stepChange, type MetricDelta } from '../layer1/delta';
import { isRateKey, stepMetrics } from '../layer1/healthModel';

/** The columns oldest first, the order every view draws them in. */
export function timeline(history: LifecycleHistory | null): LifecycleMeasureColumn[] {
  return history ? [...history.measures].reverse() : [];
}

export function cellOf(column: LifecycleMeasureColumn, stepId: string): LifecycleHistoryCell | null {
  return column.cells.find((c) => c.stepId === stepId) ?? null;
}

/** One step at one Measure as a snapshot health row; `before` is the Measure drawn left of it (or null). */
export function cellRow(column: LifecycleMeasureColumn, before: LifecycleMeasureColumn | null, stepId: string): LifecycleStepHealthView | null {
  const cell = cellOf(column, stepId);
  if (!cell) return null;
  const earlier = before ? cellOf(before, stepId) : null;
  return {
    stepId,
    health: cell.health,
    staleOf: null,
    reason: cell.reason,
    metrics: cell.metrics,
    measuredAt: column.finishedAt,
    headSha: column.headSha,
    previous: earlier && before
      ? { health: earlier.health, metrics: earlier.metrics, measuredAt: before.finishedAt, headSha: before.headSha }
      : null,
  };
}

/**
 * The snapshot's health with every tracked step replaced by its cell at the
 * viewed Measure (`index` into the drawing order). Untracked steps keep the
 * row they have now.
 */
export function travelHealth(
  now: LifecycleStepHealthView[],
  columns: LifecycleMeasureColumn[],
  index: number,
  stepIds: string[],
): LifecycleStepHealthView[] {
  const column = columns[index];
  if (!column) return now;
  const before = columns[index - 1] ?? null;
  const rows = new Map(stepIds.map((id) => [id, cellRow(column, before, id)] as const));
  const out = now.map((row) => (rows.has(row.stepId) ? rows.get(row.stepId) ?? row : row));
  for (const [id, row] of rows) if (row && !now.some((r) => r.stepId === id)) out.push(row);
  return out;
}

/** A measured verdict's rank, for whether a change was a recovery or a regression; 0 = not ranked. */
const RANK: Partial<Record<LifecycleHealth, number>> = { green: 3, amber: 2, red: 1 };

export type ChangeTone = 'good' | 'bad' | 'neutral';

export type ChangeFragment =
  | { kind: 'verdict'; stepId: string; from: LifecycleHealth; to: LifecycleHealth; tone: ChangeTone }
  | { kind: 'coverage' | 'pass' | 'time'; stepId: string; delta: MetricDelta; tone: ChangeTone };

/** The most fragments a "what changed" sentence carries; the figure holds the rest. */
export const CHANGE_CAP = 3;

const ORDER: Record<ChangeFragment['kind'], number> = { verdict: 0, coverage: 1, pass: 2, time: 3 };

function verdictTone(from: LifecycleHealth, to: LifecycleHealth): ChangeTone {
  const a = RANK[from] ?? 0;
  const b = RANK[to] ?? 0;
  if (!a || !b || a === b) return 'neutral';
  return b > a ? 'good' : 'bad';
}

/**
 * What moved between the Measure at `index` and the one drawn left of it: the
 * verdicts that changed, then coverage, pass rates and times that moved at the
 * precision they are shown at (`layer1/delta`). Empty when nothing moved; null
 * when there is no earlier Measure to compare with.
 */
export function whatChanged(columns: LifecycleMeasureColumn[], index: number, stepIds: string[]): ChangeFragment[] | null {
  const column = columns[index];
  const before = columns[index - 1];
  if (!column || !before) return null;
  const out: ChangeFragment[] = [];
  for (const stepId of stepIds) {
    const row = cellRow(column, before, stepId);
    if (!row) continue;
    const metrics = stepMetrics(stepId, row);
    const change = stepChange({ health: row.health, metrics, figure: metrics.find((m) => isRateKey(m.key)) ?? null, previous: row.previous, staleOf: null });
    if (!change) continue;
    if (change.was) out.push({ kind: 'verdict', stepId, from: change.was, to: row.health, tone: verdictTone(change.was, row.health) });
    for (const d of change.metrics) {
      if (d.direction === 'flat') continue;
      const kind = d.key === 'coverage_pct' ? 'coverage' : d.key === 'median_ms' ? 'time' : d.key === 'pass_rate' ? 'pass' : null;
      if (kind) out.push({ kind, stepId, delta: d, tone: d.tone });
    }
  }
  return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]).slice(0, CHANGE_CAP);
}

/** A step's coverage at each column (null where it was not measured): the coverage line's points. */
export function coverageSeries(columns: LifecycleMeasureColumn[], stepId = 'tests'): (number | null)[] {
  return columns.map((c) => cellOf(c, stepId)?.metrics.find((m) => m.key === 'coverage_pct')?.value ?? null);
}

/**
 * The band a coverage line is drawn in: the readings and both thresholds, with
 * a margin, so a few points of movement show (the Tests preset zooms the same
 * way). Always at least 20 points tall.
 */
export function coverageDomain(values: (number | null)[], green: number, amber: number): { lo: number; hi: number } {
  const known = values.filter((v): v is number => v != null);
  let lo = Math.max(0, Math.min(amber, ...known) - 4);
  let hi = Math.min(100, Math.max(green, ...known) + 4);
  if (hi - lo < 20) {
    const mid = (hi + lo) / 2;
    hi = Math.min(100, mid + 10);
    lo = Math.max(0, hi - 20);
    hi = Math.min(100, lo + 20);
  }
  return { lo, hi };
}
