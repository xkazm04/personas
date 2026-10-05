/**
 * Spark board-monitor: the Persona Monitor's Board view, in the REAL Monitor
 * shell (header router, fleet activity strip, the Board, the dispatch dock),
 * on the synthetic tapes in `monitorBoardTapes.mjs`.
 *
 *   monitor/board           a fleet shaped like the operator's own (30 personas:
 *                           one team of 12, one of 2, eleven singletons, five
 *                           teamless; most of it glowing on unread messages)
 *   monitor/board/zoom      the same, the biggest team zoomed (L1)
 *   monitor/board/hover     the same, the hover card up on the first needs tile
 *   monitor/board/sim       the test build's 100-persona load fleet
 *   monitor/board/sim/zoom  the load fleet with one project zoomed
 *
 * The Monitor is a fixed overlay, so it covers the frame's gutters exactly as
 * it covers the app. Each variant drives the real controls: the header's Board
 * tab, a bay's nameplate, a pointer over a tile.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { HarnessModule } from './registry';

type Step = { selector: string; act: 'click' | 'hover' } | { act: 'remount' };

/** Runs `steps` in order, each once its selector exists (polled, 10 s per step). StrictMode-safe. */
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
      if (step.act === 'remount') {
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
      if (step.act === 'click') el.click();
      else el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      i += 1;
      tries = 0;
      // Let the step's render (and a layout transition) land before the next.
      setTimeout(tick, 700);
    };
    tick();
  }, [steps]);
  return <div ref={ref} className="contents"><div key={generation} className="contents">{children}</div></div>;
}

/**
 * Close and re-open the Monitor once its first reads have landed. Under
 * StrictMode (which the app renders in too) `useMonitorData`'s `mounted` ref is
 * cleared by the simulated unmount and never re-armed, so the first open's
 * review and message badge counts reach only the module warm cache, not state
 * (a pre-existing dev-only defect, reported). The re-open paints from that
 * warm cache, exactly as a second open does in the app.
 */
const REOPEN: Step = { act: 'remount' };
/** The re-open lands on the Board (the Monitor remembers its last view): wait for it. */
const ON_BOARD: Step = { selector: '[data-testid="monitor-board"]', act: 'hover' };

const OPEN_BOARD: Step = { selector: '[data-testid="monitor-view-board"]', act: 'click' };
/** The first nameplate is the biggest bay: the Board packs largest first. */
const ZOOM_FIRST: Step = { selector: '.fb-bay__head[data-team-id]', act: 'click' };
const HOVER_NEED: Step = { selector: '.fb-tile.is-needs', act: 'hover' };

/**
 * The app loads personas at boot, and running work reaches the store as events,
 * not IPC: put both where the Monitor reads them. Two persona runs (by id, as
 * the runner now stamps them) and one app-level process for the bottom strip.
 */
async function prepareFleet(): Promise<void> {
  const [{ useAgentStore }, { useOverviewStore }] = await Promise.all([
    import('@/stores/agentStore'), import('@/stores/overviewStore'),
  ]);
  try {
    await useAgentStore.getState().fetchPersonas();
  } catch (err) {
    console.warn('[page-harness] fetchPersonas failed', err);
  }
  const now = Date.now();
  const run = (personaId: string, minutes: number) => ({
    domain: 'execution', runId: `run-${personaId}`, label: personaId, startedAt: now - minutes * 60_000,
    status: 'running' as const, toolCallCount: 4, costUsd: 0.12, personaId,
  });
  const activeProcesses = {
    'execution:run-p-board-10': run('p-board-10', 6),
    'execution:run-p-board-25': run('p-board-25', 38),
    knowledge: { domain: 'knowledge', label: 'Nightly knowledge compaction', startedAt: now - 7 * 60_000, status: 'running' as const, toolCallCount: 0, costUsd: 0 },
  };
  useOverviewStore.setState({ activeProcesses, activeProcessCount: 3 });
}

async function prepareSimulation(): Promise<void> {
  // The flag lib.rs injects into a test build; setSimulation refuses without it.
  (window as unknown as { __PERSONAS_TEST_MODE__?: boolean }).__PERSONAS_TEST_MODE__ = true;
  const { setSimulation } = await import('@/features/fleet/monitor/grid/simulation');
  setSimulation(true);
}

function monitor(steps: Step[], simulate = false): HarnessModule {
  return {
    load: async () => {
      const { PersonaMonitor } = await import('@/features/fleet/monitor/PersonaMonitor');
      return {
        default: function MonitorHost() {
          return <Drive steps={steps}><PersonaMonitor onClose={() => undefined} /></Drive>;
        },
      };
    },
    prepare: simulate ? prepareSimulation : prepareFleet,
  };
}

export const MONITOR_BOARD_MODULES: Record<string, HarnessModule> = {
  'monitor/board': monitor([OPEN_BOARD, REOPEN, ON_BOARD]),
  'monitor/board/zoom': monitor([OPEN_BOARD, REOPEN, ON_BOARD, ZOOM_FIRST]),
  'monitor/board/hover': monitor([OPEN_BOARD, REOPEN, ON_BOARD, HOVER_NEED]),
  'monitor/board/sim': monitor([OPEN_BOARD], true),
  'monitor/board/sim/zoom': monitor([OPEN_BOARD, ZOOM_FIRST], true),
};
