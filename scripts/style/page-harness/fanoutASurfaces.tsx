/**
 * console-style fan-out, partition A: harness entries for this partition's top pages.
 * Owned by the partition-A builder; registry.tsx spreads it.
 *
 *   agents/list              reused from consoleStyleSurfaces (Agents roster)
 *   home/cockpit             reused from homeCockpitSurfaces (Home > Cockpit)
 *   agents/editor-activity   persona editor, Activity tab (the executions list + feeds)
 *   agents/editor-design     persona editor, Design tab
 *   agents/editor-settings   persona editor, Settings tab
 *   triggers/live-stream     Events > Live stream
 *   triggers/studio          Events > Studio canvas
 */
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import type { EditorTab, EventBusTab } from '@/lib/types/types';
import type { HarnessModule } from './registry';

async function quietly(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.warn(`[page-harness] prepare step "${label}" failed`, err);
  }
}

const editor = (tab: EditorTab): HarnessModule => ({
  load: () => import('@/features/agents/sub_editor/components/PersonaEditor'),
  prepare: async () => {
    useSystemStore.setState({ sidebarSection: 'personas', editorTab: tab });
    await quietly('fetchPersonas', () => useAgentStore.getState().fetchPersonas());
    useAgentStore.getState().selectPersona('p-triage');
    await quietly('fetchDetail', () => useAgentStore.getState().fetchDetail('p-triage'));
  },
});

const triggers = (tab: EventBusTab): HarnessModule => ({
  load: async () => {
    const { TriggersPage } = await import('@/features/triggers/TriggersPage');
    return { default: TriggersPage };
  },
  prepare: async () => {
    useSystemStore.setState({ sidebarSection: 'events', eventBusTab: tab });
    await quietly('fetchPersonas', () => useAgentStore.getState().fetchPersonas());
  },
});

export const FANOUT_A_MODULES: Record<string, HarnessModule> = {
  'agents/editor-activity': editor('activity'),
  'agents/editor-design': editor('design'),
  'agents/editor-settings': editor('settings'),
  'triggers/live-stream': triggers('live-stream'),
  'triggers/studio': triggers('studio'),
};
