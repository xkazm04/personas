/**
 * Pure model behind the gate / tests presets: a step's run history grouped
 * into one row per command, each with its latest outcome, its time against
 * its budget, its median and its pass rate. No React, no i18n, no IO.
 *
 * Conventions this file owns:
 *
 * - `did_not_run` and `timeout` are never `failed` (the contract says so). A
 *   pass rate is passed / (passed + failed): a run that never answered is not
 *   a vote either way, and `n` says how many runs did answer.
 * - The median is over runs that ran to exit (passed or failed). A timeout's
 *   duration is the kill time and a non-run has none, so neither is a speed.
 * - Every duration is the run's own wall clock, child spawn to exit
 *   (`LifecycleRun.durationMs`); worktree setup is not included.
 */
import type { LifecycleGateCommand } from '@/lib/bindings/LifecycleGateCommand';
import type { LifecycleGateKind } from '@/lib/bindings/LifecycleGateKind';
import type { LifecycleRulesView } from '@/lib/bindings/LifecycleRulesView';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';

import { budgetFor } from '../system/rules';

/** How many runs a row's sparkline draws. */
export const SPARK_RUNS = 30;

export interface CommandRow {
  commandId: string;
  command: string;
  kind: LifecycleGateKind;
  /** Newest first, at most {@link SPARK_RUNS}. */
  runs: LifecycleRun[];
  /** Null for a configured command that has never run. */
  latest: LifecycleRun | null;
  /** The command's own budget, else its kind's default from the snapshot's rules; null when neither is known. */
  budgetMs: number | null;
  /** True when the budget is the command's own override, false for the kind's default. */
  budgetOverridden: boolean;
  medianMs: number | null;
  /** 0..100, or null when no run answered. */
  passRate: number | null;
  /** Runs that answered (passed or failed): the pass rate's denominator. */
  answered: number;
  /** The newest run's first error line, falling back to the newest run that has one. */
  firstError: string | null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function ranToExit(r: LifecycleRun): boolean {
  return r.outcome === 'passed' || r.outcome === 'failed';
}

function rowFor(id: string, runs: LifecycleRun[], cmd: LifecycleGateCommand | undefined, rules: LifecycleRulesView): CommandRow {
  const newest = runs.slice(0, SPARK_RUNS);
  const latest = newest[0] ?? null;
  const kind = cmd?.kind ?? latest?.kind ?? 'other';
  const answered = newest.filter(ranToExit);
  const passed = answered.filter((r) => r.outcome === 'passed').length;
  return {
    commandId: id,
    command: cmd?.command ?? latest?.command ?? id,
    kind,
    runs: newest,
    latest,
    budgetMs: budgetFor(rules, kind, cmd?.budgetMs ?? null),
    budgetOverridden: cmd?.budgetMs != null,
    medianMs: median(answered.map((r) => r.durationMs)),
    passRate: answered.length ? (passed / answered.length) * 100 : null,
    answered: answered.length,
    firstError: latest?.firstError ?? newest.find((r) => r.firstError)?.firstError ?? null,
  };
}

/**
 * One row per command: the configured commands first, in their order, then
 * any command seen in the history that the params no longer name (so a
 * removed command's last runs stay visible rather than vanishing).
 */
export function commandRows(
  runsNewestFirst: LifecycleRun[],
  commands: LifecycleGateCommand[] | null,
  rules: LifecycleRulesView,
): CommandRow[] {
  const byId = new Map<string, LifecycleRun[]>();
  for (const r of runsNewestFirst) {
    const list = byId.get(r.commandId) ?? [];
    list.push(r);
    byId.set(r.commandId, list);
  }
  const rows: CommandRow[] = [];
  for (const c of commands ?? []) rows.push(rowFor(c.id, byId.get(c.id) ?? [], c, rules));
  for (const [id, runs] of byId) if (!rows.some((r) => r.commandId === id)) rows.push(rowFor(id, runs, undefined, rules));
  return rows;
}

/** The command whose latest answered run took longest, or null when none has run. */
export function slowest(rows: CommandRow[]): CommandRow | null {
  let pick: CommandRow | null = null;
  for (const r of rows) {
    if (!r.latest || !ranToExit(r.latest)) continue;
    if (!pick || r.latest.durationMs > pick.latest!.durationMs) pick = r;
  }
  return pick;
}

/** Coverage readings, oldest first for drawing: the `valuePct` of coverage-kind runs that reported one. */
export function coverageTrend(runsNewestFirst: LifecycleRun[]): number[] {
  return runsNewestFirst
    .filter((r) => r.kind === 'coverage' && r.valuePct != null)
    .slice(0, SPARK_RUNS)
    .map((r) => r.valuePct!)
    .reverse();
}
