// GATE preset: the step's history strip (pick a past Measure to see its
// runs), the step's commands as measured rows (outcome, time against budget,
// trend, pass rate) and the commands editor under them. `TestsPreset` reuses
// the body with the coverage panel above it. Budgets come from the snapshot's
// rules (a command's own budget overrides its kind's default). The rows show
// the Measure the page's time cursor is on (`history/timeTravel`).

import { useMemo } from 'react';

import type { JourneyNode } from '../../journey/journeyModel';
import { HistoryStrip } from '../history/HistoryStrip';
import { useTimeTravel } from '../history/timeTravel';
import { useSnapshotRules } from '../system/useSnapshotRules';
import { CommandRows } from './CommandRows';
import { CommandsEditor } from './CommandsEditor';
import { commandRows } from './gateModel';
import type { PresetData } from './presetData';
import { useCommandsEditor, type CommandsEditorState } from './useCommandsEditor';

export function GateBody({ node, data, editor }: { node: JourneyNode; data: PresetData; editor: CommandsEditorState }) {
  const rules = useSnapshotRules();
  const runs = data.detail?.runs;
  const commands = node.view.step.params.commands;
  const rows = useMemo(() => commandRows(runs ?? [], commands, rules), [runs, commands, rules]);
  const { viewing } = useTimeTravel();
  return (
    <>
      <CommandRows rows={rows} loading={data.loading} unavailable={data.unavailable} measureId={viewing?.measureId ?? null} />
      <CommandsEditor editor={editor} commands={commands} />
    </>
  );
}

export function GatePreset({ node, data }: { node: JourneyNode; data: PresetData }) {
  const editor = useCommandsEditor(node.view.step, data.detail?.runs ?? []);
  return (
    <>
      <HistoryStrip stepId={node.id} />
      <GateBody node={node} data={data} editor={editor} />
    </>
  );
}
