/**
 * What a command's run history says about it beyond its latest outcome. Pure:
 * no React, no i18n, no IO.
 *
 * - FLAKY: across its last {@link FLAKY_WINDOW} runs that answered (passed or
 *   failed), the outcome flipped at least {@link FLAKY_MIN_FLIPS} times, with
 *   both passes and failures among them. The backend has no such rule; this
 *   one is the screen's own reading of the runs it already holds.
 * - SLOWING: the mean of its newest {@link SLOWING.recentRuns} answered runs is
 *   more than {@link SLOWING.factor} times the median of the answered runs
 *   before them, once there are at least {@link SLOWING.minPriorRuns} of those.
 *   This is the backend's slow-gate regression rule, the one that files a
 *   "slow gate" backlog item (documented in src-tauri/src/lifecycle/slow.rs);
 *   `__tests__/signalsParity.test.ts` reads that file's constants and fails
 *   when these numbers differ from them.
 * - FILED: an open slow-gate backlog item about the command, the backend's own
 *   verdict that it is slow (over budget or regressing), carried alongside.
 *
 * A run that never answered (`did_not_run`, `timeout`) is not a vote for
 * either signal: it has no honest outcome and no honest duration.
 */
import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';

import { median } from '../gateModel';

/** How many answered runs the flaky reading looks back over. */
export const FLAKY_WINDOW = 10;
/** Outcome changes between neighbouring answered runs that make a command flaky. */
export const FLAKY_MIN_FLIPS = 3;

/** The slow-gate regression rule's numbers (tethered by `signalsParity.test.ts`). */
export const SLOWING = {
  /** Newest answered runs whose mean is compared. */
  recentRuns: 3,
  /** Answered runs before those that the rule needs at least. */
  minPriorRuns: 5,
  /** How much slower the recent mean must be than the prior median. */
  factor: 1.3,
} as const;

/** Backlog statuses that are still open (a decided or delivered item is not a live signal). */
const OPEN_ITEM = new Set(['pending', 'accepted']);

export type AnsweredOutcome = 'passed' | 'failed';

export interface FlakyEvidence {
  /** The window's outcomes, oldest first. */
  window: AnsweredOutcome[];
  flips: number;
  passes: number;
  failures: number;
}

export interface SlowingEvidence {
  recentMeanMs: number;
  priorMedianMs: number;
  /** recentMean / priorMedian. */
  ratio: number;
  recentRuns: number;
  priorRuns: number;
}

export interface CommandSignals {
  flaky: FlakyEvidence | null;
  slowing: SlowingEvidence | null;
  /** The open slow-gate backlog item about this command, if one is filed. */
  filed: LifecycleRelatedItem | null;
}

export const NO_SIGNALS: CommandSignals = { flaky: null, slowing: null, filed: null };

export function answered(runsNewestFirst: LifecycleRun[]): LifecycleRun[] {
  return runsNewestFirst.filter((r) => r.outcome === 'passed' || r.outcome === 'failed');
}

export function flakyOf(runsNewestFirst: LifecycleRun[]): FlakyEvidence | null {
  const window = answered(runsNewestFirst)
    .slice(0, FLAKY_WINDOW)
    .map((r) => r.outcome as AnsweredOutcome)
    .reverse();
  let flips = 0;
  for (let i = 1; i < window.length; i++) if (window[i] !== window[i - 1]) flips++;
  const passes = window.filter((o) => o === 'passed').length;
  const failures = window.length - passes;
  if (flips < FLAKY_MIN_FLIPS || passes === 0 || failures === 0) return null;
  return { window, flips, passes, failures };
}

export function slowingOf(runsNewestFirst: LifecycleRun[]): SlowingEvidence | null {
  const runs = answered(runsNewestFirst);
  if (runs.length < SLOWING.recentRuns + SLOWING.minPriorRuns) return null;
  const recent = runs.slice(0, SLOWING.recentRuns);
  const prior = runs.slice(SLOWING.recentRuns);
  const recentMeanMs = recent.reduce((a, r) => a + r.durationMs, 0) / recent.length;
  const priorMedianMs = median(prior.map((r) => r.durationMs)) ?? 0;
  if (priorMedianMs <= 0 || !(recentMeanMs > SLOWING.factor * priorMedianMs)) return null;
  return { recentMeanMs, priorMedianMs, ratio: recentMeanMs / priorMedianMs, recentRuns: recent.length, priorRuns: prior.length };
}

export function filedSlowItem(related: LifecycleRelatedItem[], commandId: string): LifecycleRelatedItem | null {
  return related.find((i) => i.source === 'slow_gate' && i.commandId === commandId && OPEN_ITEM.has(i.status)) ?? null;
}

export function signalsOf(runsNewestFirst: LifecycleRun[], related: LifecycleRelatedItem[], commandId: string): CommandSignals {
  return { flaky: flakyOf(runsNewestFirst), slowing: slowingOf(runsNewestFirst), filed: filedSlowItem(related, commandId) };
}
