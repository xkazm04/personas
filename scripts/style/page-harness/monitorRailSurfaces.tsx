/**
 * The Activity desk's rail rows (`RailRowView`), on the tapes in
 * `monitorRailTapes.mjs`.
 *
 *   monitor/rail         the REAL Monitor shell on Activity in the test
 *                        build's simulation, the DecisionDock opened on
 *                        Reviews by its own resting figure
 *   monitor/rail/kinds   the row alone in a desk-width column, one of every
 *                        thing it can draw: the six triage kinds (review at
 *                        two severities), a selectable dispatch idea (one
 *                        checked), a timed message-style row, a group band
 */
import { useEffect, useRef, type ReactNode } from 'react';
import type { HarnessModule } from './registry';

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

async function preparePersonas(): Promise<void> {
  const { useAgentStore } = await import('@/stores/agentStore');
  try {
    await useAgentStore.getState().fetchPersonas();
  } catch (err) {
    console.warn('[page-harness] fetchPersonas failed', err);
  }
}

const DOCK_STEPS = ['[data-testid="monitor-view-activity"]', '[data-testid="activity-rail-stat-reviews"]'];

async function prepareSimulation(): Promise<void> {
  // The flag lib.rs injects into a test build; setSimulation refuses without it.
  (window as unknown as { __PERSONAS_TEST_MODE__?: boolean }).__PERSONAS_TEST_MODE__ = true;
  const { setSimulation } = await import('@/features/fleet/monitor/grid/simulation');
  setSimulation(true);
}

const noop = () => undefined;

async function kindsHost() {
  const [{ RailList }, { RailRowView, railRowHeight }, model, { useAgentStore }, lucide] = await Promise.all([
    import('@/features/fleet/monitor/grid/rail/RailList'),
    import('@/features/fleet/monitor/grid/rail/RailRowView'),
    import('@/features/fleet/monitor/grid/rail/railModel'),
    import('@/stores/agentStore'),
    import('lucide-react'),
  ]);
  type Kind = 'review' | 'idea' | 'question' | 'policy' | 'evolution' | 'goal';
  const item = (id: string, kind: Kind, title: string, label: string, personaId: string | null, severity?: string) => ({
    id, sourceId: id, kind, title, body: '', facts: [], branches: [], weight: 1,
    tags: severity ? [{ id: 'severity', label: severity, tone: 'neutral' }] : [],
    personaId, source: { label, color: null }, createdAt: '2026-10-05T08:00:00Z',
    verdictLabels: { accept: 'a', reject: 'r', skip: 's' },
  });
  return {
    default: function KindsHost() {
      const personas = useAgentStore((s) => s.personas);
      const personaOf = (id: string) => personas.find((p) => p.id === id);
      const triage = [
        item('k1', 'review', 'Invoice batch 1142 failed reconciliation against the ledger', 'Invoice Reconciler', 'p-board-20', 'critical'),
        item('k2', 'review', 'DNS change on the staging zone needs a second pair of eyes', 'DNS Auditor', 'p-board-16', 'medium'),
        item('k3', 'idea', 'Split the parser module before the next release', 'Personas Desktop', null),
        item('k4', 'question', 'Which region should the new bucket live in?', 'Landing Runner', 'p-board-6'),
        item('k5', 'policy', 'Raise the retry ceiling for flaky connectors', 'Policy tuning', null),
        item('k6', 'evolution', 'Promote the shorter system prompt variant', 'Release Noter', 'p-board-0'),
        item('k7', 'goal', 'Weekly digest shipped to the team channel', 'Culture Digest', 'p-board-17'),
      ].map((it) => model.triageToRow(it as never, it.kind[0]!.toUpperCase() + it.kind.slice(1), personaOf));
      const idea = (id: string, title: string) => model.ideaToRow({
        id, title, projectId: 'p', projectName: 'Personas Desktop', category: null, origin: null,
        priority: null, impact: null, effort: null, acceptedAt: '2026-10-04T10:00:00Z', ageHours: 20,
      } as never, 'Dispatch');
      const timed = {
        ...model.ideaToRow({ id: 'k10', title: '', projectName: null } as never, ''),
        id: 'k10', tone: 'neutral' as const, icon: lucide.Activity, title: 'Nightly sweep finished, three items are waiting',
        source: 'Ops', at: '2026-10-05T09:40:00Z', selectable: false, showTime: true, showKind: false, kind: 'channel',
      };
      const band = { ...triage[2]!, id: 'k11', groupHeader: 'Personas Desktop', accent: '#06b6d4' };
      const rows = [...triage, idea('k8', 'Wire the retry budget into the runner'), idea('k9', 'Cache the roster between opens'), timed, band];
      return (
        <div className="flex h-full justify-end bg-background">
          <div className="flex h-full w-[340px] flex-col border-l border-border">
            <RailList
              rows={rows}
              heightOf={railRowHeight}
              renderRow={(row) => (
                <RailRowView
                  row={row}
                  selected={row.id === 'k8'}
                  onToggle={row.selectable ? noop : undefined}
                  onOpen={row.selectable ? undefined : noop}
                  onAccept={row.decidable ? noop : undefined}
                  onReject={row.decidable ? noop : undefined}
                />
              )}
              hasMore={false}
              loading={false}
              onEndReached={noop}
              empty={null}
              testId="rail-kinds"
            />
          </div>
        </div>
      );
    },
  };
}

export const MONITOR_RAIL_MODULES: Record<string, HarnessModule> = {
  'monitor/rail': {
    load: async () => {
      const { PersonaMonitor } = await import('@/features/fleet/monitor/PersonaMonitor');
      return {
        default: function MonitorHost() {
          return <Drive steps={DOCK_STEPS}><PersonaMonitor onClose={() => undefined} /></Drive>;
        },
      };
    },
    prepare: prepareSimulation,
  },
  'monitor/rail/kinds': { load: kindsHost, prepare: preparePersonas },
};
