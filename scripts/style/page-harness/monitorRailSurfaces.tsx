/**
 * The Activity band's Decision Center strip, on the tape in
 * `monitorRailTapes.mjs`.
 *
 *   monitor/rail         the REAL Monitor shell on Activity in the test
 *                        build's simulation, the strip's Gates chip pressed so
 *                        its peek hangs open under it
 *
 * Until 2026-10-06 this module shot the DecisionDock (opened on Reviews by its
 * own resting figure) and, as `monitor/rail/kinds`, the dock's row component
 * alone. Both were retired with the dock (decision-center spark A3); the
 * module name is kept so the tape and any saved shots keep their address.
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

const STRIP_STEPS = ['[data-testid="monitor-view-activity"]', '[data-testid="decision-chip-gates"]'];

async function prepareSimulation(): Promise<void> {
  // The flag lib.rs injects into a test build; setSimulation refuses without it.
  (window as unknown as { __PERSONAS_TEST_MODE__?: boolean }).__PERSONAS_TEST_MODE__ = true;
  const { setSimulation } = await import('@/features/fleet/monitor/grid/simulation');
  setSimulation(true);
}

export const MONITOR_RAIL_MODULES: Record<string, HarnessModule> = {
  'monitor/rail': {
    load: async () => {
      const { PersonaMonitor } = await import('@/features/fleet/monitor/PersonaMonitor');
      return {
        default: function MonitorHost() {
          return <Drive steps={STRIP_STEPS}><PersonaMonitor onClose={() => undefined} /></Drive>;
        },
      };
    },
    prepare: prepareSimulation,
  },
};
