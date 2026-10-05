/**
 * The Monitor's Activity board in its two layouts, in the REAL Monitor shell,
 * on the tapes in `monitorActivityTapes.mjs`.
 *
 *   monitor/classic       Classic bays: the Board's real-shaped 30-persona fleet
 *                         plus ten sessions in every painted state (three in the
 *                         biggest bay, one in the tray) and a queue of four
 *   monitor/lanes         the same fleet's sessions as Running / Queued / Parked
 *   monitor/classic/sim   the test build's 100-persona load fleet, Classic
 *   monitor/lanes/sim     the load fleet's sessions and its 30-row queue, Lanes
 *
 * Each variant drives the real controls: the header's Activity tab and the
 * board's layout switch.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { HarnessModule } from './registry';

type Step = { selector: string } | { act: 'remount' };

/** Clicks each selector once it exists (polled, 10 s per step); `remount` re-opens the page. StrictMode-safe. */
function Drive({ steps, children }: { steps: Step[]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const root = ref.current;
    if (!root || root.dataset.driven) return;
    root.dataset.driven = '1';
    let i = 0;
    let tries = 0;
    const tick = () => {
      const step = steps[i];
      if (!step) return;
      if ('act' in step) {
        setGeneration((g) => g + 1);
        i += 1;
        setTimeout(tick, 900);
        return;
      }
      const el = document.querySelector<HTMLElement>(step.selector);
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
  return <div ref={ref} className="contents"><div key={generation} className="contents">{children}</div></div>;
}

async function prepareFleet(): Promise<void> {
  const [{ useAgentStore }, { useOverviewStore }] = await Promise.all([
    import('@/stores/agentStore'), import('@/stores/overviewStore'),
  ]);
  try {
    await useAgentStore.getState().fetchPersonas();
  } catch (err) {
    console.warn('[page-harness] fetchPersonas failed', err);
  }
  // Running persona work reaches the store as events, not IPC (the Board surface's own setup).
  const now = Date.now();
  const run = (personaId: string, minutes: number) => ({
    domain: 'execution', runId: `run-${personaId}`, label: personaId, startedAt: now - minutes * 60_000,
    status: 'running' as const, toolCallCount: 4, costUsd: 0.12, personaId,
  });
  useOverviewStore.setState({
    activeProcesses: { 'execution:run-p-board-10': run('p-board-10', 6), 'execution:run-p-board-25': run('p-board-25', 38) },
    activeProcessCount: 2,
  });
}

async function prepareSimulation(): Promise<void> {
  (window as unknown as { __PERSONAS_TEST_MODE__?: boolean }).__PERSONAS_TEST_MODE__ = true;
  const { setSimulation } = await import('@/features/fleet/monitor/grid/simulation');
  setSimulation(true);
}

/** The re-open is the Board surface's workaround: StrictMode strands the first open's badge reads. */
const steps = (layout: 'classic' | 'lanes'): Step[] => [
  { selector: '[data-testid="monitor-view-activity"]' },
  { act: 'remount' },
  { selector: `[data-testid="fleet-board-variant-${layout}"]` },
];

function monitor(layout: 'classic' | 'lanes', simulate: boolean): HarnessModule {
  const plan = steps(layout);
  return {
    load: async () => {
      const { PersonaMonitor } = await import('@/features/fleet/monitor/PersonaMonitor');
      return {
        default: function MonitorHost() {
          return <Drive steps={plan}><PersonaMonitor onClose={() => undefined} /></Drive>;
        },
      };
    },
    prepare: simulate ? prepareSimulation : prepareFleet,
  };
}

export const MONITOR_ACTIVITY_MODULES: Record<string, HarnessModule> = {
  'monitor/classic': monitor('classic', false),
  'monitor/lanes': monitor('lanes', false),
  'monitor/classic/sim': monitor('classic', true),
  'monitor/lanes/sim': monitor('lanes', true),
};
