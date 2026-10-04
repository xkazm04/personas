/**
 * Kit batch overview-1 (builder AI): the two Overview inbox surfaces —
 * Approvals (`sub_manual-review/ManualReviewList`, which opens on the pending
 * focus flow) and Incidents (`sub_incidents/IncidentsInbox`) — on the synthetic
 * tapes in `inboxTapes.mjs`.
 *
 * Neither surface had a harness view before this batch, so the BEFORE shots are
 * the first ones either has ever had.
 *
 * Both pages read their data through their own hooks and stores; neither needs a
 * React context provider above it. `prepare` puts the stores in the state the
 * app holds on the route (sidebar section + overview tab) and warms personas,
 * which Approvals joins for the queue's persona names and the workspace tint.
 */
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import type { OverviewTab } from '@/lib/types/types';
import type { HarnessModule } from './registry';

function prepare(tab: OverviewTab, warmTeams: boolean) {
  return async (): Promise<void> => {
    useSystemStore.setState({ sidebarSection: 'overview' });
    useOverviewStore.setState({ overviewTab: tab });
    try {
      await useAgentStore.getState().fetchPersonas();
    } catch (err) {
      console.warn('[page-harness] fetchPersonas failed', err);
    }
    if (!warmTeams) return;
    // The app prewarms teams in PersonasPage's startup fan-out; Approvals reads
    // them (never fetches them) to resolve a persona's workspace, so the harness
    // has to arrive on the route with them already in the store.
    try {
      await usePipelineStore.getState().fetchTeams({ force: true });
    } catch (err) {
      console.warn('[page-harness] fetchTeams failed', err);
    }
  };
}

export const INBOX_MODULES: Record<string, HarnessModule> = {
  'overview/sub_manual-review': {
    load: () => import('@/features/overview/sub_manual-review/components/ManualReviewList'),
    prepare: prepare('manual-review', true),
  },
  'overview/sub_incidents': {
    load: () => import('@/features/overview/sub_incidents/components/IncidentsInbox'),
    prepare: prepare('incidents', false),
  },
};
