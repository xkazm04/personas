/**
 * The Activity board under the `lanes` decision surface (spark mandate-lanes,
 * WP4), in the REAL Monitor shell, on the tapes in `mandateLanesTapes.mjs`:
 *
 *   monitor/mandate-lanes            Bays, with the lane buttons in the
 *                                    command bar, the Stewards plate in the
 *                                    supply column and the nameplate lamps
 *   monitor/mandate-lanes/register   the mandate register (M), opened from
 *                                    the Stewards plate
 *   monitor/mandate-lanes/page       a mandate page: act log first, envelope rail
 *   monitor/mandate-lanes/ticker     the dock's act ticker (WP7) after three
 *                                    router filings arrive on the act stream
 *   monitor/mandate-lanes/ticker/log the ticker pressed: the act log opened
 *                                    at the line's newest act
 *
 * Each variant drives the real controls (the Activity tab, the layout switch,
 * the plate's register button, a register row).
 */
import { useEffect, type ReactNode } from 'react';
import type { HarnessModule } from './registry';
import { Drive, prepareFleet, steps, type Step } from './monitorActivitySurfaces';
import { TICKER_ACTS } from './mandateLanesTapes.mjs';

async function prepareLanes(): Promise<void> {
  await prepareFleet();
  const { useSystemStore } = await import('@/stores/systemStore');
  useSystemStore.setState({ decisionSurface: 'lanes' });
}

/**
 * Pushes the ticker's acts on `charter-act-recorded` once the board is up,
 * through the tape player's mocked event bus (the way the backend announces
 * an act). Harness-only: the app has no such clock.
 */
function ActStream({ children }: { children: ReactNode }) {
  useEffect(() => {
    let live = true;
    const at = window.setTimeout(() => {
      void import('@tauri-apps/api/event').then(async ({ emit }) => {
        for (const act of TICKER_ACTS) if (live) await emit('charter-act-recorded', act);
      });
    }, 2500);
    return () => { live = false; window.clearTimeout(at); };
  }, []);
  return <>{children}</>;
}

function lanes(extra: Step[] = [], stream = false): HarnessModule {
  const plan = [...steps('classic'), ...extra];
  return {
    load: async () => {
      const { PersonaMonitor } = await import('@/features/fleet/monitor/PersonaMonitor');
      return {
        default: function MandateLanesHost() {
          const monitor = <Drive steps={plan}><PersonaMonitor onClose={() => undefined} /></Drive>;
          return stream ? <ActStream>{monitor}</ActStream> : monitor;
        },
      };
    },
    prepare: prepareLanes,
  };
}

const REGISTER: Step = { selector: '[data-testid="fleet-stewards-register"]' };

export const MANDATE_LANES_MODULES: Record<string, HarnessModule> = {
  'monitor/mandate-lanes': lanes(),
  'monitor/mandate-lanes/register': lanes([REGISTER]),
  'monitor/mandate-lanes/page': lanes([REGISTER, { selector: '[data-testid="mandate-register-row"] button' }]),
  'monitor/mandate-lanes/ticker': lanes([], true),
  'monitor/mandate-lanes/ticker/log': lanes([{ selector: '[data-testid="dock-act-ticker-open"]' }], true),
};
