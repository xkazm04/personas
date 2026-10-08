// GATE preset: the step's commands as measured rows (outcome, time against
// budget, trend, pass rate) and the commands editor under them. `TestsPreset`
// reuses the body with the coverage panel above it. Budgets come from the
// snapshot's rules (a command's own budget overrides its kind's default).
import { useMemo } from 'react';

import type { JourneyNode } from '../../journey/journeyModel';
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
  return (
    <>
      <CommandRows rows={rows} loading={data.loading} unavailable={data.unavailable} />
      <CommandsEditor editor={editor} commands={commands} />
    </>
  );
}

export function GatePreset({ node, data }: { node: JourneyNode; data: PresetData }) {
  const editor = useCommandsEditor(node.view.step, data.detail?.runs ?? []);
  return <GateBody node={node} data={data} editor={editor} />;
}
