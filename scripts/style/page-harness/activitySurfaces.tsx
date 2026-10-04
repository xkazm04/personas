/**
 * Kit batch overview-1 (`overview/components/dashboard/ExecutionsWithSubtabs`):
 * the Overview > Executions surface and its three lenses, inside the Overview
 * filter provider, on the synthetic tapes in `activityTapes.mjs`.
 *
 * The surface had NO harness view before this batch, so the BEFORE shots are
 * the first ones it has ever had. Each variant drives the real control the way
 * a user would; the selector lists the consolidated tab first and the control
 * it replaced after it, so one entry serves both halves of a before/after pair
 * (the Metrics lens was a toggle button in Activity's own header before, and
 * the Calls tab carried no test id).
 */
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useAgentStore } from '@/stores/agentStore';
import type { HarnessModule } from './registry';

async function prepareActivity(): Promise<void> {
  useSystemStore.setState({ sidebarSection: 'overview' });
  useOverviewStore.setState({ overviewTab: 'executions' });
  // The app loads personas at boot; both execution tables resolve the persona
  // name, icon and fallback model from them.
  try {
    await useAgentStore.getState().fetchPersonas();
  } catch (err) {
    console.warn('[page-harness] fetchPersonas failed', err);
  }
}

/** Clicks the first element matching `selector` once it exists (polled for up to 5 s). StrictMode-safe. */
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

const surface = () =>
  import('@/features/overview/components/dashboard/ExecutionsWithSubtabs') as Promise<{ default: ComponentType }>;

function page(click?: string) {
  return async (): Promise<{ default: ComponentType }> => {
    const { default: Page } = await surface();
    return {
      default: function ExecutionsHost() {
        return click ? <ClickWhenReady selector={click}><Page /></ClickWhenReady> : <Page />;
      },
    };
  };
}

const providers = async () => {
  const { OverviewFilterProvider } = await import('@/features/overview/components/dashboard/OverviewFilterContext');
  return (children: ReactNode) => <OverviewFilterProvider>{children}</OverviewFilterProvider>;
};

const entry = (click?: string): HarnessModule => ({ load: page(click), providers, prepare: prepareActivity });

export const ACTIVITY_MODULES: Record<string, HarnessModule> = {
  'overview/sub_activity': entry(),
  // Before: the switcher's second segment carried no test id.
  'overview/sub_activity/calls': entry('[data-testid="exec-tab-calls"], [role="tab"]:nth-child(2)'),
  // Before: a toggle button in Activity's own header, titled "Show metrics dashboard".
  'overview/sub_activity/metrics': entry('[data-testid="exec-tab-metrics"], button[title="Show metrics dashboard"]'),
};
