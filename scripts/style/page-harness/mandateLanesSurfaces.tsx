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
 *
 * Each variant drives the real controls (the Activity tab, the layout switch,
 * the plate's register button, a register row).
 */
import type { HarnessModule } from './registry';
import { Drive, prepareFleet, steps, type Step } from './monitorActivitySurfaces';

async function prepareLanes(): Promise<void> {
  await prepareFleet();
  const { useSystemStore } = await import('@/stores/systemStore');
  useSystemStore.setState({ decisionSurface: 'lanes' });
}

function lanes(extra: Step[] = []): HarnessModule {
  const plan = [...steps('classic'), ...extra];
  return {
    load: async () => {
      const { PersonaMonitor } = await import('@/features/fleet/monitor/PersonaMonitor');
      return {
        default: function MandateLanesHost() {
          return <Drive steps={plan}><PersonaMonitor onClose={() => undefined} /></Drive>;
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
};
