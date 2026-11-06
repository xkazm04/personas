/**
 * console-style fan-out, partition D: harness entries for this partition's pages.
 * Owned by the partition-D builder; registry.tsx spreads it (wired by the Director).
 *
 *   overview/sub_reports   Overview > Messages (ReportList), populated with a mixed read/unread list
 */
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

async function quietly(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.warn(`[page-harness] prepare step "${label}" failed`, err);
  }
}

export const FANOUT_D_MODULES: Record<string, HarnessModule> = {
  'overview/sub_reports': {
    load: () => import('@/features/overview/sub_reports/components/ReportList'),
    prepare: async () => {
      useSystemStore.setState({ sidebarSection: 'overview' });
      await quietly('fetchPersonas', () => useAgentStore.getState().fetchPersonas());
    },
  },
};
