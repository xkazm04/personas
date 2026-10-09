// GATE preset: the step's commands as row-instruments (outcome, run history
// drawn against the budget, time against budget, pass rate, flaky / slowing
// signals), ordered and filtered by a toolbar, a press on any run opening it
// in the run viewer, and the commands editor under them. `TestsPreset` reuses
// the body with the coverage panel above it. Budgets come from the snapshot's
// rules (a command's own budget overrides its kind's default) and can be
// edited in place on a row. The rows show the Measure the page's time cursor
// is on (`history/timeTravel`), picked on the history strip in the band.

import { useCallback, useMemo, useState, type ReactNode } from 'react';

import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';

import type { JourneyNode } from '../../journey/journeyModel';
import { useTimeTravel } from '../history/timeTravel';
import { useSnapshotRules } from '../system/useSnapshotRules';
import { CommandRows } from './CommandRows';
import { CommandsEditor } from './CommandsEditor';
import { instrumentRows, rememberView, rememberedView, type GateViewState, type InstrumentRow } from './gate/gateView';
import { RunViewer, type OpenRun } from './gate/RunViewer';
import { useBudgetEdit } from './gate/useBudgetEdit';
import { commandRows } from './gateModel';
import type { PresetData } from './presetData';
import { useCommandsEditor, type CommandsEditorState } from './useCommandsEditor';

const NO_RUNS: LifecycleRun[] = [];

/** What a preset draws above the rows (Tests' coverage), handed the way to open a run and the viewed Measure. */
export type GateLead = (openRun: (run: LifecycleRun) => void, measureId: string | null) => ReactNode;

export function GateBody({ node, data, editor, lead }: { node: JourneyNode; data: PresetData; editor: CommandsEditorState; lead?: GateLead }) {
  const rules = useSnapshotRules();
  const runs = data.detail?.runs ?? NO_RUNS;
  const related = data.detail?.related;
  const step = node.view.step;
  const commands = step.params.commands;
  const { viewing } = useTimeTravel();
  const measureId = viewing?.measureId ?? null;
  const rows = useMemo(
    () => instrumentRows(commandRows(runs, commands, rules), related ?? [], measureId),
    [runs, commands, rules, related, measureId],
  );
  const [view, setView] = useState<GateViewState>(() => rememberedView(step.id));
  const onView = useCallback((next: GateViewState) => { setView(next); rememberView(step.id, next); }, [step.id]);
  const budget = useBudgetEdit(step, runs);
  const [open, setOpen] = useState<{ commandId: string; runId: string } | null>(null);
  const openRun = useCallback((run: LifecycleRun) => setOpen({ commandId: run.commandId, runId: run.id }), []);
  const onOpen = useCallback((_row: InstrumentRow, run: LifecycleRun) => openRun(run), [openRun]);
  // Resolved against the live rows, so a refetch keeps the viewer on the same run.
  const openRow = open ? rows.find((r) => r.commandId === open.commandId) : undefined;
  const openedRun = openRow?.runs.find((r) => r.id === open?.runId);
  const viewer: OpenRun | null = openRow && openedRun ? { row: openRow, run: openedRun } : null;
  return (
    <>
      {lead?.(openRun, measureId)}
      <CommandRows
        rows={rows}
        loading={data.loading}
        unavailable={data.unavailable}
        measureId={measureId}
        view={view}
        onView={onView}
        budget={budget}
        onOpen={onOpen}
      />
      <CommandsEditor editor={editor} commands={commands} />
      <RunViewer open={viewer} onWalk={(run) => setOpen((o) => (o ? { ...o, runId: run.id } : o))} onClose={() => setOpen(null)} />
    </>
  );
}

export function GatePreset({ node, data }: { node: JourneyNode; data: PresetData }) {
  const editor = useCommandsEditor(node.view.step, data.detail?.runs ?? []);
  return <GateBody node={node} data={data} editor={editor} />;
}
