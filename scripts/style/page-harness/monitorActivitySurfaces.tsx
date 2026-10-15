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
 * Device mesh (spark device-mesh), on the Classic / Lanes tapes plus the mesh
 * fixture (`meshFixture.ts`: this device, Studio Desktop live, Travel Laptop
 * stale; live samples on three sessions and two personas):
 *
 *   monitor/classic/mesh        the device strip, and Studio's bay in the rail
 *   monitor/classic/mesh/peer   the board scoped to Studio Desktop (its agents'
 *                               on/off switches, its queue)
 *   monitor/classic/mesh/stale  the board scoped to the stale Travel Laptop
 *   monitor/lanes/mesh/move     a local queued rung's "Move to..." menu, open
 *   monitor/charter/measured    the charter card's measured load with a
 *                               mismatch badge on a pinned profile
 *
 * Each variant drives the real controls: the header's Activity tab and the
 * board's layout switch.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { HarnessModule } from './registry';

export type Step = { selector: string } | { act: 'remount' };

/** Clicks each selector once it exists (polled, 10 s per step); `remount` re-opens the page. StrictMode-safe. */
export function Drive({ steps, children }: { steps: Step[]; children: ReactNode }) {
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

export async function prepareFleet(): Promise<void> {
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
export const steps = (layout: 'classic' | 'lanes'): Step[] => [
  { selector: '[data-testid="monitor-view-activity"]' },
  { act: 'remount' },
  { selector: `[data-testid="fleet-board-variant-${layout}"]` },
];

const STUDIO = 'fixture-studio-7c1e9a04';
const LAPTOP = 'fixture-laptop-3a90f4c2';

async function prepareMesh(): Promise<void> {
  await prepareFleet();
  const { seedMeshFixture } = await import('@/stores/slices/network/meshFixture');
  seedMeshFixture({ sessionIds: ['s-run-1', 's-run-2', 's-run-3'], personaIds: ['p-board-10', 'p-board-25'] });
}

function monitor(layout: 'classic' | 'lanes', simulate: boolean, extra: Step[] = [], mesh = false): HarnessModule {
  const plan = [...steps(layout), ...extra];
  return {
    load: async () => {
      const { PersonaMonitor } = await import('@/features/fleet/monitor/PersonaMonitor');
      return {
        default: function MonitorHost() {
          return <Drive steps={plan}><PersonaMonitor onClose={() => undefined} /></Drive>;
        },
      };
    },
    prepare: simulate ? prepareSimulation : mesh ? prepareMesh : prepareFleet,
  };
}

/** The charter card on a pinned "heavy" profile whose runs measure "exclusive". */
const charterMeasured: HarnessModule = {
  load: async () => {
    const [{ CharterResourceCard }, layout] = await Promise.all([
      import('@/features/agents/sub_responsibilities/components/CharterResourceCard'),
      import('@/features/shared/components/layout/ContentLayout'),
    ]);
    const { measuredCache } = await import('@/features/agents/sub_responsibilities/libs/useCharterMeasured');
    measuredCache.set('p-board-10', [{
      responsibilityId: 'charter-render', passes: 9, avgCostUsd: 0.42, avgTokens: 180_000, peakRssMb: null,
      measuredEffort: 'm', resourceRuns: 9, cpuP95Share: 0.64, ramPeakShare: 0.31, gpuP95Share: 0.07,
      dominant: 'cpu', measuredMachine: 'exclusive', measuredGpu: 'shared',
    }]);
    const charter = {
      id: 'charter-render', title: 'Render the nightly preview',
      spec: { resourceProfile: {
        machine: 'heavy', gpu: 'none', difficulty: 'standard', effort: 'm', source: 'operator', pinned: true,
        rationale: null, declaredAt: null,
      } },
    } as never;
    return {
      default: function CharterHost() {
        // The measured row sits under the four pickers; bring it into the frame.
        useEffect(() => {
          const t = setTimeout(() => document.querySelector('[data-testid="resp-profile-axes"]')?.scrollIntoView({ block: 'center' }), 300);
          return () => clearTimeout(t);
        }, []);
        return (
          <layout.ContentBox>
            <layout.ContentHeader title="Charter" subtitle="Render the nightly preview" />
            <layout.ContentBody>
              <div className="max-w-4xl">
                <CharterResourceCard charter={charter} personaId="p-board-10" onPatch={async () => undefined} />
              </div>
            </layout.ContentBody>
          </layout.ContentBox>
        );
      },
    };
  },
};

export const MONITOR_ACTIVITY_MODULES: Record<string, HarnessModule> = {
  'monitor/classic': monitor('classic', false),
  'monitor/lanes': monitor('lanes', false),
  'monitor/classic/sim': monitor('classic', true),
  'monitor/lanes/sim': monitor('lanes', true),
  'monitor/classic/mesh': monitor('classic', false, [], true),
  'monitor/classic/mesh/peer': monitor('classic', false, [{ selector: `[data-testid="mesh-plate"][data-peer-id="${STUDIO}"]` }], true),
  'monitor/classic/mesh/stale': monitor('classic', false, [{ selector: `[data-testid="mesh-plate"][data-peer-id="${LAPTOP}"]` }], true),
  'monitor/lanes/mesh/move': monitor('lanes', false, [{ selector: '[data-testid="mesh-move-to"]' }], true),
  'monitor/charter/measured': charterMeasured,
};
