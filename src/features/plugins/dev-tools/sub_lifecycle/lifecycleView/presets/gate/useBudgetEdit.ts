/**
 * The in-place budget edit on a gate row: one row at a time, seconds as
 * typed, saved through the same `setLifecycleStepParams` path as the commands
 * editor (a new practice version authored `operator`). An empty field clears
 * the command's own budget, so its kind's default applies again.
 *
 * From auto-detected params (`commands === null`) the save pins the commands
 * the run history shows, exactly as the commands editor's draft starts, so a
 * budget edit never silently drops a command detection was running.
 *
 * The outcome is said inline (`result`, read by an always-mounted live line);
 * a failure keeps the field open with what was typed.
 */
import { useCallback, useState } from 'react';

import { setLifecycleStepParams } from '@/api/devTools/lifecycle';
import type { LifecycleGateCommand } from '@/lib/bindings/LifecycleGateCommand';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';
import type { LifecycleStep } from '@/lib/bindings/LifecycleStep';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../../context';
import { seenInRuns, type EditorResult } from '../useCommandsEditor';

/** Seconds as typed to a budget in ms: null for empty (the kind's default), undefined when invalid. */
export function parseBudgetSeconds(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : undefined;
}

/** The commands with one command's budget replaced, or null when the command is not among them. */
export function withBudget(commands: LifecycleGateCommand[], commandId: string, budgetMs: number | null): LifecycleGateCommand[] | null {
  if (!commands.some((c) => c.id === commandId)) return null;
  return commands.map((c) => (c.id === commandId ? { ...c, budgetMs } : c));
}

export function useBudgetEdit(step: LifecycleStep, runs: LifecycleRun[]) {
  const { dl, tx, projectId } = useLifecycleViewModel();
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<EditorResult | null>(null);
  const base = step.params.commands ?? seenInRuns(runs);

  /** Whether a command's budget can be edited here (it is one the params would save). */
  const editable = (commandId: string) => base.some((c) => c.id === commandId);

  const open = useCallback((commandId: string, ownMs: number | null) => {
    setEditing(commandId);
    setText(ownMs == null ? '' : String(ownMs / 1000));
    setInvalid(false);
    setResult(null);
  }, []);

  const cancel = useCallback(() => { setEditing(null); setInvalid(false); }, []);

  const save = async (commandId: string, command: string) => {
    const budgetMs = parseBudgetSeconds(text);
    if (budgetMs === undefined) {
      setInvalid(true);
      return;
    }
    const commands = withBudget(base, commandId, budgetMs);
    if (!projectId || !commands) return;
    setSaving(true);
    try {
      await setLifecycleStepParams(projectId, step.id, { ...step.params, commands });
      setEditing(null);
      setResult({
        tone: 'success',
        text: budgetMs == null
          ? tx(dl.lcx6_budget_cleared, { command })
          : tx(dl.lcx6_budget_saved, { command, budget: formatNumeric(budgetMs, 'ms') }),
      });
    } catch (err) {
      silentCatch('lifecycle:setBudget')(err);
      setResult({ tone: 'error', text: resolveError(err instanceof Error ? err.message : String(err)).message });
    } finally {
      setSaving(false);
    }
  };

  const type = (value: string) => { setText(value); setInvalid(false); };

  return { editing, text, invalid, saving, result, editable, open, cancel, save, type };
}

export type BudgetEditState = ReturnType<typeof useBudgetEdit>;
