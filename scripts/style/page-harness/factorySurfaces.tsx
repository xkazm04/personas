/**
 * Module 5 (`teams/sub_factory`): the Factory page as PersonasPage mounts it
 * (FactoryPage > FactoryDataProvider > TrendVariant), on the synthetic tapes in
 * `factoryTapes.mjs`.
 *
 * L1 is the page as it opens. The L2 views land on one project and tab the way
 * the app's own cross-feature door does (the Mastermind island menu sets
 * `pendingFactoryFocus`, FactoryShell consumes it once). L3 and L4 are reached
 * through the matrix's own controls. Each selector lists the composed control
 * first and the pre-kit one after it, so one tape and one entry serve both
 * halves of a before/after pair.
 */
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

const MAIN = 'p-atlas';
type L2Tab = 'overview' | 'matrix' | 'observability';

async function prepareFactory(focus?: L2Tab): Promise<void> {
  useSystemStore.setState({ sidebarSection: 'personas', pendingFactoryFocus: focus ? { projectId: MAIN, l2Tab: focus } : null });
  // The app loads the vault's credentials at boot; the L2 tabs resolve the
  // project's LLM tracker and monitoring connector from them.
  try {
    const { useVaultStore } = await import('@/stores/vaultStore');
    await useVaultStore.getState().fetchCredentials();
  } catch (err) {
    console.warn('[page-harness] fetchCredentials failed', err);
  }
}

/** Clicks the first element matching `selector` once it exists (polled for up to 8 s). StrictMode-safe. */
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
      if (tries++ < 160) setTimeout(tick, 50);
    };
    tick();
  }, [selector]);
  return <div ref={ref} className="contents">{children}</div>;
}

const factory = () => import('@/features/teams/sub_factory/FactoryPage') as Promise<{ default: ComponentType }>;

function page(click?: string) {
  return async (): Promise<{ default: ComponentType }> => {
    const { default: Page } = await factory();
    return {
      default: function FactoryHost() {
        return click ? <ClickWhenReady selector={click}><Page /></ClickWhenReady> : <Page />;
      },
    };
  };
}

const entry = (focus?: L2Tab, click?: string): HarnessModule => ({ load: page(click), prepare: () => prepareFactory(focus) });

export const FACTORY_MODULES: Record<string, HarnessModule> = {
  'factory/landing': entry(),
  'factory/overview': entry('overview'),
  // The second context row (pre-kit: the second context card; it has no click, so BEFORE is the plain overview).
  'factory/select': entry('overview', 'tr[data-testid="factory-context-row"]:nth-child(2)'),
  'factory/matrix': entry('matrix'),
  'factory/observability': entry('observability'),
  // Open the Authentication group's KPI table (pre-kit: the group band button).
  'factory/group': entry('matrix', '[data-testid="factory-open-group-g-auth"], [data-testid="trend-variant"] button.w-full'),
  // Open the Login success rate console (pre-kit: the spark cell button titled with the KPI).
  'factory/console': entry('matrix', '[data-testid="factory-open-kpi-k-login-conv"], button[title^="Login success rate:"]'),
};
