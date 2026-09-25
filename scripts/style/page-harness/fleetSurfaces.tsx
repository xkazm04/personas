/**
 * Module 3 (`plugins/fleet` sub_grid, sub_activity, sub_settings): the three
 * pages the Fleet plugin's tab strip switches between, each mounted inside the
 * same column FleetPage gives it (FleetPage.tsx), on the synthetic tapes in
 * `fleetTapes.mjs`.
 *
 * The FleetPage root (its tab strip and orphan badge) is left out on purpose:
 * other sessions develop it, and a before/after pair must move only because
 * the sub-page changed.
 *
 * `fleet/grid/insights` is the Sessions page with its right pane switched to
 * Insights, through the page's own toggle once the session rows are in.
 */
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

const PROJECT = 'proj-fleet';
const FOCUSED = 's-idle-1';

function prepareFleet(): void {
  // The project picked in Dev Tools and the session last focused on the Sessions tab.
  useSystemStore.setState({ activeProjectId: PROJECT, fleetActiveSessionId: FOCUSED });
}

/** Clicks `selector` once it exists (polled for up to 5 s). Guarded against StrictMode's double effect. */
function ClickWhenReady({ selector, children }: { selector: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || root.dataset.driven) return;
    root.dataset.driven = '1';
    let tries = 0;
    const tick = () => {
      const el = root.querySelector<HTMLElement>(selector);
      if (el) { el.click(); return; }
      if (tries++ < 100) setTimeout(tick, 50);
    };
    tick();
  }, [selector]);
  return <div ref={ref} className="contents">{children}</div>;
}

function inFleetColumn(load: () => Promise<{ default: ComponentType }>, click?: string) {
  return async (): Promise<{ default: ComponentType }> => {
    const { default: Page } = await load();
    return {
      default: function FleetHost() {
        const page = (
          <div className="h-full w-full flex flex-col">
            <div className="flex-1 min-h-0 flex flex-col">
              <Page />
            </div>
          </div>
        );
        return click ? <ClickWhenReady selector={click}>{page}</ClickWhenReady> : page;
      },
    };
  };
}

const grid = () => import('@/features/plugins/fleet/sub_grid/FleetGridPage');
const activity = () => import('@/features/plugins/fleet/sub_activity/FleetActivityPage') as Promise<{ default: ComponentType }>;
const settings = () => import('@/features/plugins/fleet/sub_settings/FleetSettingsPage');

export const FLEET_MODULES: Record<string, HarnessModule> = {
  'fleet/grid': { load: inFleetColumn(grid), prepare: prepareFleet },
  'fleet/grid/insights': { load: inFleetColumn(grid, '[data-testid="fleet-rightview-insights"]'), prepare: prepareFleet },
  'fleet/activity': { load: inFleetColumn(activity), prepare: prepareFleet },
  'fleet/settings': { load: inFleetColumn(settings), prepare: prepareFleet },
};
