// THE FIRST-RUN SETUP, as data: when Layer 1 offers it, the checklist it
// starts from, the coverage commands it may suggest, and what saving writes.
// Pure: no React, no i18n, no IO.
//
// - A project that has never been measured (no Measure tip, or no health row
//   with a sample) gets the setup in the status plate's slot (`needsSetup`).
// - The checklist is what each command-running step will run: the commands a
//   step pins (`params.commands`), else what auto-detection finds in the repo's
//   manifests right now (`dev_tools_lifecycle_detect_commands`). Each row is
//   on by default; the step it belongs to is the rules' (`rules.stepKinds`),
//   never a client copy of `detect_commands::step_of`.
// - Coverage templates are SUGGESTIONS: offered only when no coverage command
//   is on the list, picked from the stack the list itself shows (a JS test
//   runner, a Cargo manifest) and added only when the reader says so.
import type { LifecycleGateCommand } from '@/lib/bindings/LifecycleGateCommand';
import type { LifecycleGateKind } from '@/lib/bindings/LifecycleGateKind';
import type { LifecycleRulesView } from '@/lib/bindings/LifecycleRulesView';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { draftToCommands, type DraftCommand } from '../../presets/useCommandsEditor';
import { kindsForStep } from '../../system/rules';

/** The steps whose commands Measure runs, in the order the setup lists them. */
export const SETUP_STEPS = ['gate', 'tests'] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];

/** Never measured: no Measure has run on a tip, or no health row carries a single sample. */
export function needsSetup(snapshot: LifecycleSnapshot | null): boolean {
  if (!snapshot) return false;
  const sampled = snapshot.health.some((h) => h.metrics.some((m) => (m.samples ?? 0) > 0));
  return snapshot.tip?.measuredSha == null || !sampled;
}

/** Where a checklist row came from. */
export type SetupOrigin = 'configured' | 'detected' | 'template';

export interface SetupRow extends DraftCommand {
  /** Run it: an off row is left out of what is saved. */
  on: boolean;
  origin: SetupOrigin;
  /** The template a suggested row came from. */
  templateId?: TemplateId;
}

/** The step a command kind is measured under, by the snapshot's rules; null for a kind no step measures. */
export function stepOfKind(rules: LifecycleRulesView, kind: LifecycleGateKind): SetupStepId | null {
  return SETUP_STEPS.find((s) => kindsForStep(rules, s).includes(kind)) ?? null;
}

let seq = 0;
const nextKey = () => `setup-${++seq}`;

function row(c: LifecycleGateCommand, origin: SetupOrigin): SetupRow {
  return { key: nextKey(), id: c.id, command: c.command, kind: c.kind, budgetSec: c.budgetMs == null ? '' : String(c.budgetMs / 1000), on: true, origin };
}

/**
 * The checklist to start from: per step, the commands it pins when it pins
 * any, else the detected commands of that step's kinds. Detected commands of a
 * kind no step measures are dropped (the rules decide, not this file).
 */
export function initialRows(snapshot: LifecycleSnapshot, detected: readonly LifecycleGateCommand[]): SetupRow[] {
  const out: SetupRow[] = [];
  for (const stepId of SETUP_STEPS) {
    const pinned = snapshot.steps.find((s) => s.step.id === stepId)?.step.params.commands ?? null;
    if (pinned) out.push(...pinned.map((c) => row(c, 'configured')));
    else out.push(...detected.filter((c) => stepOfKind(snapshot.rules, c.kind) === stepId).map((c) => row(c, 'detected')));
  }
  return out;
}

export type TemplateId = 'vitest' | 'jest' | 'llvm-cov';

export interface CoverageTemplate {
  id: TemplateId;
  command: string;
  /** Needs a tool installed first (cargo-llvm-cov). */
  needsInstall: boolean;
}

/** How a JS command line runs a package binary, by the runner the detected list uses. */
function execPrefix(command: string): string | null {
  const runner = /^(npm|pnpm|yarn)\s/.exec(command.trim())?.[1];
  if (runner === 'npm') return 'npx';
  if (runner === 'pnpm') return 'pnpm exec';
  if (runner === 'yarn') return 'yarn';
  return null;
}

/**
 * The coverage commands worth suggesting, or none when the list already has a
 * coverage command. A JS test command suggests Vitest and Jest (the one the
 * project's stack names first); a Cargo command suggests cargo-llvm-cov, on the
 * same manifest. Every suggestion prints a summary the Measure can read.
 */
export function coverageTemplates(rows: readonly Pick<SetupRow, 'command' | 'kind'>[], techStack: string | null): CoverageTemplate[] {
  if (rows.some((r) => r.kind === 'coverage')) return [];
  const out: CoverageTemplate[] = [];
  const js = rows.map((r) => execPrefix(r.command)).find((p): p is string => p !== null);
  if (js) {
    const vitest: CoverageTemplate = { id: 'vitest', command: `${js} vitest run --coverage --coverage.reporter=text-summary`, needsInstall: false };
    const jest: CoverageTemplate = { id: 'jest', command: `${js} jest --coverage --coverageReporters=text-summary`, needsInstall: false };
    const stack = (techStack ?? '').toLowerCase();
    out.push(...(stack.includes('jest') && !stack.includes('vitest') ? [jest, vitest] : [vitest, jest]));
  }
  const cargo = rows.find((r) => /^cargo\s/.test(r.command.trim()));
  if (cargo) {
    const manifest = /--manifest-path\s+(\S+)/.exec(cargo.command)?.[1];
    out.push({ id: 'llvm-cov', command: `cargo llvm-cov --summary-only${manifest ? ` --manifest-path ${manifest}` : ''}`, needsInstall: true });
  }
  return out;
}

/** A suggestion taken onto the checklist: a coverage row, on, marked as suggested. */
export function templateRow(t: CoverageTemplate): SetupRow {
  return { key: nextKey(), id: '', command: t.command, kind: 'coverage', budgetSec: '', on: true, origin: 'template', templateId: t.id };
}

/**
 * What saving writes: per step, the commands its rows hold that are on. A step
 * with no row at all is left alone (its auto-detection stays in force); a step
 * whose rows are all off is saved empty, because that is what the reader chose.
 */
export function stepCommands(rules: LifecycleRulesView, rows: readonly SetupRow[]): Partial<Record<SetupStepId, LifecycleGateCommand[]>> {
  const out: Partial<Record<SetupStepId, LifecycleGateCommand[]>> = {};
  for (const stepId of SETUP_STEPS) {
    const mine = rows.filter((r) => stepOfKind(rules, r.kind) === stepId);
    if (mine.length > 0) out[stepId] = draftToCommands(mine.filter((r) => r.on));
  }
  return out;
}

/** The checklist differs from where it started: a row switched, a budget typed, a suggestion added. */
export function isEdited(start: readonly SetupRow[], now: readonly SetupRow[]): boolean {
  if (start.length !== now.length) return true;
  return now.some((r, i) => {
    const s = start[i]!;
    return r.key !== s.key || r.on !== s.on || r.budgetSec.trim() !== s.budgetSec.trim();
  });
}
