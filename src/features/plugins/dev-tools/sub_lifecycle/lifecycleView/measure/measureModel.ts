/**
 * Pure model behind a running Measure (`snapshot.progress`): where each
 * command stands, how its time compares with its median, how long the whole
 * Measure has left, which rail steps it is measuring, how its commands came
 * out once it ended, and what changed between the snapshot before it and the
 * one after. No React, no i18n, no IO.
 *
 * Conventions this file owns:
 *
 * 1. THE ESTIMATE IS THE MEDIAN. A command's ETA is its `medianMs` (the
 *    backend's median over recent complete Measures). No median is "first
 *    run, no estimate", never a guess.
 * 2. OVER is past `OVER_FACTOR` x the median: a run that slow is worth a
 *    warning tone; a run a little past its median is not.
 * 3. The total left is the sum over unfinished commands (the backend runs
 *    them one after another): a running command contributes what is left of
 *    its median (never below zero), a pending one its whole median. Commands
 *    with no median are COUNTED, not guessed.
 * 4. THE SUMMARY IS THE HISTORY'S DELTA. What a Measure changed is the same
 *    fragment builder as the history's "what changed" line
 *    (`historyModel.changeFragments`), fed the rows after with the rows
 *    before as their `previous`. There is no third delta logic.
 */
import type { LifecycleCommandProgress } from '@/lib/bindings/LifecycleCommandProgress';
import type { LifecycleGateKind } from '@/lib/bindings/LifecycleGateKind';
import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';
import type { LifecycleMeasureProgress } from '@/lib/bindings/LifecycleMeasureProgress';
import type { LifecycleRulesView } from '@/lib/bindings/LifecycleRulesView';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';
import type { LifecycleStepHealthView } from '@/lib/bindings/LifecycleStepHealthView';

import { changeFragments, type ChangeFragment } from '../history/historyModel';
import type { PillTone } from '../system/pillLooks';
import { RUN_LOOK } from '../system/pillLooks';

/** A running command this many times past its median is drawn in the warning tone. */
export const OVER_FACTOR = 1.5;

export type SegmentTone = 'pending' | 'running' | 'over' | PillTone;

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** How long a command has been running at `now` (0 before it starts, its duration once done). */
export function elapsedMs(cmd: LifecycleCommandProgress, now: number): number {
  if (cmd.state === 'done') return cmd.durationMs ?? 0;
  const start = ms(cmd.startedAt);
  return cmd.state === 'running' && start != null ? Math.max(0, now - start) : 0;
}

/** A running command past `OVER_FACTOR` x its median (never true without a median). */
export function isOver(cmd: LifecycleCommandProgress, now: number): boolean {
  return cmd.state === 'running' && cmd.medianMs != null && cmd.medianMs > 0 && elapsedMs(cmd, now) > cmd.medianMs * OVER_FACTOR;
}

/** One segment of the progress track: waiting, running (or running long), or the run's outcome tone. */
export function segmentTone(cmd: LifecycleCommandProgress, now: number): SegmentTone {
  if (cmd.state === 'pending') return 'pending';
  if (cmd.state === 'running') return isOver(cmd, now) ? 'over' : 'running';
  return cmd.outcome ? RUN_LOOK[cmd.outcome].tone : 'neutral';
}

export interface Tally {
  done: number;
  total: number;
}

/** "2 of 5": the commands done out of the commands planned. */
export function tally(progress: LifecycleMeasureProgress | null): Tally {
  const commands = progress?.commands ?? [];
  return { done: commands.filter((c) => c.state === 'done').length, total: commands.length };
}

export interface MeasureEta {
  /** What the known medians say is left, in ms. */
  remainingMs: number;
  /** Unfinished commands with no median (their time is not in `remainingMs`). */
  unknown: number;
  /** Unfinished commands at all. */
  open: number;
}

/** What the whole Measure has left at `now` (convention 3). */
export function measureEta(progress: LifecycleMeasureProgress | null, now: number): MeasureEta {
  let remainingMs = 0;
  let unknown = 0;
  let open = 0;
  for (const c of progress?.commands ?? []) {
    if (c.state === 'done') continue;
    open += 1;
    if (c.medianMs == null) {
      unknown += 1;
      continue;
    }
    remainingMs += c.state === 'running' ? Math.max(0, c.medianMs - elapsedMs(c, now)) : c.medianMs;
  }
  return { remainingMs, unknown, open };
}

/** The step whose commands are of `kind` (gate or tests), from the rules the snapshot ships. */
export function stepForKind(rules: LifecycleRulesView, kind: LifecycleGateKind): string | null {
  return rules.stepKinds.find((s) => s.kinds.includes(kind))?.stepId ?? null;
}

/**
 * The rail steps a Measure is measuring, each with its own tally. While the
 * plan is still resolving (`progress` null) every step the rules say runs
 * commands is measuring, with an unknown tally (total 0).
 */
export function measuringSteps(progress: LifecycleMeasureProgress | null, rules: LifecycleRulesView): Map<string, Tally> {
  const out = new Map<string, Tally>();
  if (!progress) {
    for (const s of rules.stepKinds) out.set(s.stepId, { done: 0, total: 0 });
    return out;
  }
  for (const c of progress.commands) {
    const step = stepForKind(rules, c.kind);
    if (!step) continue;
    const t = out.get(step) ?? { done: 0, total: 0 };
    out.set(step, { done: t.done + (c.state === 'done' ? 1 : 0), total: t.total + 1 });
  }
  return out;
}

/**
 * The commands as they came out, once the Measure ended. The last progress
 * seen may still show the final command running (the snapshot that ends the
 * Measure carries no progress), so a command that is not done takes its run
 * from the Measure's history column when there is one; a cancelled Measure's
 * unfinished commands did not run (the backend records them so).
 */
export function finalCommands(
  progress: LifecycleMeasureProgress | null,
  column: LifecycleMeasureColumn | null,
  cancelled: boolean,
): LifecycleCommandProgress[] {
  return (progress?.commands ?? []).map((c) => {
    if (c.state === 'done') return c;
    const run = column?.runs.find((r) => r.commandId === c.commandId);
    if (run) return { ...c, state: 'done', outcome: run.outcome, durationMs: run.durationMs };
    if (cancelled) return { ...c, state: 'done', outcome: 'did_not_run', durationMs: null };
    return c;
  });
}

/** How long the Measure took: from its start to the last command's end, as the runs report it. */
export function measureTookMs(commands: LifecycleCommandProgress[]): number {
  return commands.reduce((a, c) => a + (c.state === 'done' ? c.durationMs ?? 0 : 0), 0);
}

/** A health row as the `previous` of another: the step as judged before the Measure. */
function asPrevious(row: LifecycleStepHealthView): LifecycleStepHealthView['previous'] {
  return { health: row.health, metrics: row.metrics, measuredAt: row.measuredAt, headSha: row.headSha };
}

/**
 * What the Measure changed for the steps it measures (convention 4). With no
 * snapshot from before it (the page opened mid-Measure), each row keeps the
 * `previous` the backend sent, which for a Measure step IS the Measure before.
 */
export function measureChange(
  before: LifecycleSnapshot | null,
  after: LifecycleSnapshot,
  stepIds: string[],
): ChangeFragment[] {
  const rows = stepIds.map((id) => {
    const now = after.health.find((h) => h.stepId === id);
    if (!now) return null;
    if (!before) return now;
    const then = before.health.find((h) => h.stepId === id);
    return then ? { ...now, previous: asPrevious(then) } : { ...now, previous: null };
  });
  return changeFragments(rows);
}

/** The steps whose verdict the Measure changed (their rail cards settle once). */
export function changedVerdicts(before: LifecycleSnapshot | null, after: LifecycleSnapshot, stepIds: string[]): Set<string> {
  const out = new Set<string>();
  if (!before) return out;
  for (const id of stepIds) {
    const a = before.health.find((h) => h.stepId === id)?.health;
    const b = after.health.find((h) => h.stepId === id)?.health;
    if (a && b && a !== b) out.add(id);
  }
  return out;
}
