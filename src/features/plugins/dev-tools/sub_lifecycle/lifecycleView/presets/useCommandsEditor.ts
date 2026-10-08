/**
 * The commands editor's state: a draft of a gate / tests step's commands and
 * its save through `setLifecycleStepParams` (which appends a version authored
 * `operator`). The result is said inline under the editor; no toast.
 *
 * `params.commands === null` means "auto-detect from the repo's manifests".
 * Editing from that state starts from the commands the run history shows, so
 * pinning the list never silently drops what detection was already running.
 */
import { useCallback, useRef, useState } from 'react';

import { setLifecycleStepParams } from '@/api/devTools/lifecycle';
import type { LifecycleGateCommand } from '@/lib/bindings/LifecycleGateCommand';
import type { LifecycleGateKind } from '@/lib/bindings/LifecycleGateKind';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';
import type { LifecycleStep } from '@/lib/bindings/LifecycleStep';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch } from '@/lib/silentCatch';

import { useLifecycleViewModel } from '../context';
import { kindsForStep } from './healthRules';

export interface DraftCommand {
  /** React key; stable across edits. */
  key: string;
  /** The command's id; empty for a new row (derived from the command on save). */
  id: string;
  command: string;
  kind: LifecycleGateKind;
  /** Seconds as typed; empty = the kind's default budget. */
  budgetSec: string;
}

export interface EditorResult { tone: 'success' | 'error'; text: string }

let seq = 0;
const nextKey = () => `cmd-${++seq}`;

function toDraft(c: LifecycleGateCommand): DraftCommand {
  return { key: nextKey(), id: c.id, command: c.command, kind: c.kind, budgetSec: c.budgetMs == null ? '' : String(c.budgetMs / 1000) };
}

function seenInRuns(runs: LifecycleRun[]): LifecycleGateCommand[] {
  const out: LifecycleGateCommand[] = [];
  for (const r of runs) if (!out.some((c) => c.id === r.commandId)) out.push({ id: r.commandId, command: r.command, kind: r.kind, budgetMs: null });
  return out;
}

export function slugFor(command: string, taken: Set<string>): string {
  const base = command.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'command';
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** A row's problem, or null. Exported for the unit test. */
export function draftProblem(d: DraftCommand): 'command' | 'budget' | null {
  if (!d.command.trim()) return 'command';
  if (d.budgetSec.trim() && !(Number(d.budgetSec) > 0)) return 'budget';
  return null;
}

export function draftToCommands(draft: DraftCommand[]): LifecycleGateCommand[] {
  const taken = new Set(draft.map((d) => d.id).filter(Boolean));
  return draft.map((d) => {
    const id = d.id || slugFor(d.command, taken);
    taken.add(id);
    const budget = d.budgetSec.trim() ? Math.round(Number(d.budgetSec) * 1000) : null;
    return { id, command: d.command.trim(), kind: d.kind, budgetMs: budget };
  });
}

export function useCommandsEditor(step: LifecycleStep, runs: LifecycleRun[]) {
  const { dl, projectId } = useLifecycleViewModel();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftCommand[]>([]);
  const [saving, setSaving] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [result, setResult] = useState<EditorResult | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const kinds = kindsForStep(step.id);

  const open = useCallback((prefillKind?: LifecycleGateKind) => {
    const base = (step.params.commands ?? seenInRuns(runs)).map(toDraft);
    if (prefillKind) base.push({ key: nextKey(), id: '', command: '', kind: prefillKind, budgetSec: '' });
    setDraft(base);
    setEditing(true);
    setShowProblems(false);
    setResult(null);
    rootRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [step.params.commands, runs]);

  const add = () => setDraft((d) => [...d, { key: nextKey(), id: '', command: '', kind: kinds[0] ?? 'other', budgetSec: '' }]);
  const update = (key: string, patch: Partial<DraftCommand>) => setDraft((d) => d.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const remove = (key: string) => setDraft((d) => d.filter((c) => c.key !== key));
  const cancel = () => { setEditing(false); setResult(null); };

  const persist = async (commands: LifecycleGateCommand[] | null) => {
    if (!projectId) return;
    setSaving(true);
    try {
      await setLifecycleStepParams(projectId, step.id, { ...step.params, commands });
      setEditing(false);
      setResult({ tone: 'success', text: commands ? dl.lc2_commands_saved : dl.lc2_commands_saved_auto });
    } catch (err) {
      silentCatch('lifecycle:setStepParams')(err);
      setResult({ tone: 'error', text: resolveError(err instanceof Error ? err.message : String(err)).message });
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (draft.some((d) => draftProblem(d))) {
      setShowProblems(true);
      return;
    }
    await persist(draftToCommands(draft));
  };

  return { rootRef, kinds, editing, draft, saving, showProblems, result, open, add, update, remove, cancel, save, resetToAuto: () => persist(null) };
}

export type CommandsEditorState = ReturnType<typeof useCommandsEditor>;
