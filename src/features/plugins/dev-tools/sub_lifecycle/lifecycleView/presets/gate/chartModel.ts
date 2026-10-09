/**
 * The geometry of a command's run-history chart (`RunChart`), pure: one bar
 * per run, oldest on the left, heights as fractions of one scale.
 *
 * - A run that answered is a solid bar of its duration, toned by how it came
 *   out: failed (error), passed over its budget (warning), passed (success).
 * - A timeout's duration is the kill time and a run that never started has
 *   none, so neither is drawn as a speed: each is a short stub of fixed
 *   height (hatched for a timeout, hollow for did-not-run).
 * - The scale's top fits the budget line and the bars. One outlier must not
 *   flatten the rest, so past {@link CLIP_FACTOR} times the median the scale
 *   stops and a taller bar is drawn full height with a break mark.
 * - The faint band is the middle half of the answered runs (25th to 75th
 *   percentile), with the median drawn through it.
 */
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';

import { median } from '../gateModel';

export const CLIP_FACTOR = 2.5;
/** A stub's height as a share of the plot, for a run with no honest time. */
export const STUB = 0.3;
/** The floor a short answered bar is drawn at, so a 1 s run still reads as a bar. */
const MIN_BAR = 0.06;

export type BarKind = 'passed' | 'over' | 'failed' | 'timeout' | 'did_not_run';

export interface ChartBar {
  run: LifecycleRun;
  kind: BarKind;
  /** 0..1 of the plot height. */
  height: number;
  /** Taller than the scale: drawn full height with a break mark. */
  clipped: boolean;
}

export interface ChartModel {
  bars: ChartBar[];
  /** 0..1, or null with no budget known. */
  budgetAt: number | null;
  /** The middle-half band and the median, 0..1; null with fewer than 3 answered runs. */
  band: { low: number; high: number; median: number } | null;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function barKind(run: LifecycleRun, budgetMs: number | null): BarKind {
  if (run.outcome === 'timeout' || run.outcome === 'did_not_run') return run.outcome;
  if (run.outcome === 'failed') return 'failed';
  return budgetMs != null && run.durationMs > budgetMs ? 'over' : 'passed';
}

/** `runsNewestFirst` as the row holds them; the chart draws them oldest first. */
export function chartModel(runsNewestFirst: LifecycleRun[], budgetMs: number | null): ChartModel {
  const runs = [...runsNewestFirst].reverse();
  const times = runs.filter((r) => r.outcome === 'passed' || r.outcome === 'failed').map((r) => r.durationMs);
  const max = Math.max(0, ...times);
  const mid = median(times) ?? max;
  const fitTop = max > mid * CLIP_FACTOR ? mid * CLIP_FACTOR : max;
  const top = Math.max(1, fitTop, budgetMs ?? 0) * 1.08;
  const at = (ms: number) => Math.min(1, ms / top);
  const bars = runs.map((run): ChartBar => {
    const kind = barKind(run, budgetMs);
    if (kind === 'timeout' || kind === 'did_not_run') return { run, kind, height: STUB, clipped: false };
    return { run, kind, height: Math.max(MIN_BAR, at(run.durationMs)), clipped: run.durationMs > top };
  });
  const sorted = [...times].sort((a, b) => a - b);
  const band = sorted.length >= 3
    ? { low: at(quantile(sorted, 0.25)), high: at(quantile(sorted, 0.75)), median: at(quantile(sorted, 0.5)) }
    : null;
  return { bars, budgetAt: budgetMs != null ? at(budgetMs) : null, band };
}
