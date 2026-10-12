/**
 * Kit batch overview-1 (builder AI): the two Overview inbox surfaces —
 * Approvals (`sub_manual-review/ManualReviewList`, which opens on the pending
 * list whose rows open the Decision Deck) and Incidents (`sub_incidents/IncidentsInbox`) — on the synthetic
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
import { lazy, Suspense, useEffect, useRef, type ComponentType, type ReactNode } from 'react';
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

// ── Decision Deck over the inboxes (decision-center wave 3, package C2) ──────
//
// The Overview tabs are history views now: a pending row opens the ONE global
// Decision Deck. These modules mount the real page beside the real
// `DecisionDeckHost` (the app mounts it once in GlobalOverlays) and press the
// page's own door - so the shot proves the door, not a hand-set store.

/** Clicks each selector once it exists (polled, 10 s per step). StrictMode-safe. */
function Drive({ steps, children }: { steps: string[]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || root.dataset.driven) return;
    root.dataset.driven = '1';
    let i = 0;
    let tries = 0;
    const tick = () => {
      const selector = steps[i];
      if (!selector) return;
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) {
        if (tries++ < 200) setTimeout(tick, 50);
        return;
      }
      el.click();
      i += 1;
      tries = 0;
      setTimeout(tick, 700);
    };
    tick();
  }, [steps]);
  return <div ref={ref} className="contents">{children}</div>;
}

const DeckHost = lazy(() => import('@/features/decision-center/deck/DecisionDeckHost'));

function withDeck(load: () => Promise<{ default: ComponentType }>, steps: string[]) {
  return async () => {
    const { default: Page } = await load();
    function PageWithDeck() {
      return (
        <Drive steps={steps}>
          <Page />
          <Suspense fallback={null}>
            <DeckHost />
          </Suspense>
        </Drive>
      );
    }
    return { default: PageWithDeck };
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
  'overview/sub_manual-review/deck': {
    load: withDeck(
      () => import('@/features/overview/sub_manual-review/components/ManualReviewList'),
      ['[data-testid="pending-decide-all"]'],
    ),
    prepare: prepare('manual-review', true),
  },
  'overview/sub_incidents/deck': {
    load: withDeck(
      () => import('@/features/overview/sub_incidents/components/IncidentsInbox'),
      ['#incident-row-inc-001'],
    ),
    prepare: prepare('incidents', false),
  },
};
