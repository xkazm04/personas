// GATE preset: the step's commands as measured rows (outcome, time against
// budget, trend, pass rate) and the commands editor under them. `TestsPreset`
// reuses the body with the coverage panel above it.
import { useMemo } from 'react';

import type { LifecycleStepDetail } from '@/lib/bindings/LifecycleStepDetail';

import type { JourneyNode } from '../../journey/journeyModel';
import { CommandRows } from './CommandRows';
import { CommandsEditor } from './CommandsEditor';
import { commandRows } from './gateModel';
import { useCommandsEditor, type CommandsEditorState } from './useCommandsEditor';

export interface PresetData {
  detail: LifecycleStepDetail | null;
  /** First load in flight with nothing warm to show. */
  loading: boolean;
  /** The detail read failed and nothing warm is on screen. */
  unavailable: boolean;
}

export function GateBody({ node, data, editor }: { node: JourneyNode; data: PresetData; editor: CommandsEditorState }) {
  const runs = data.detail?.runs;
  const commands = node.view.step.params.commands;
  const rows = useMemo(() => commandRows(runs ?? [], commands), [runs, commands]);
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
