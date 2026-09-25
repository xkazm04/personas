/**
 * Module 4 (`overview/sub_observability`): the Observability dashboard inside
 * the Overview filter provider, on the synthetic tapes in `observabilityTapes.mjs`.
 *
 * The dashboard is not routed in the app today (no file in src/ imports it,
 * see src/lib/analytics/navCatalog.ts), so there is no recorded tape; the
 * `prepare` step does what OverviewContent's pipeline would have done on the
 * way in (useExecutionDashboardPipeline): load personas, metrics, health
 * issues, alert rules and history, and stamp each source as fetched.
 *
 * Variants drive the page through its own controls once it has data. Each
 * selector lists the composed control first and the pre-kit one after it, so
 * one tape and one entry serve both halves of a before/after pair.
 */
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useAgentStore } from '@/stores/agentStore';
import type { HarnessModule } from './registry';

async function prepareObservability(): Promise<void> {
  useSystemStore.setState({ sidebarSection: 'overview' });
  try {
    await useAgentStore.getState().fetchPersonas();
  } catch (err) {
    console.warn('[page-harness] fetchPersonas failed', err);
  }
  const s = useOverviewStore.getState();
  await Promise.allSettled([
    s.fetchObservabilityMetrics(30),
    s.fetchHealingIssues(),
    s.fetchAlertRules(true),
    s.fetchAlertHistory(true),
  ]);
  s.applyPipelineResults(['observabilityMetrics', 'healingIssues', 'alertRules', 'alertHistory'].map((source) => ({ source, error: null })));
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

const dashboard = () => import('@/features/overview/sub_observability/components/ObservabilityDashboard') as Promise<{ default: ComponentType }>;

function page(click?: string) {
  return async (): Promise<{ default: ComponentType }> => {
    const { default: Page } = await dashboard();
    return {
      default: function ObservabilityHost() {
        return click ? <ClickWhenReady selector={click}><Page /></ClickWhenReady> : <Page />;
      },
    };
  };
}

const providers = async () => {
  const { OverviewFilterProvider } = await import('@/features/overview/components/dashboard/OverviewFilterContext');
  return (children: ReactNode) => <OverviewFilterProvider>{children}</OverviewFilterProvider>;
};

const entry = (click?: string): HarnessModule => ({ load: page(click), providers, prepare: prepareObservability });

export const OBSERVABILITY_MODULES: Record<string, HarnessModule> = {
  'observability/dashboard': entry(),
  'observability/alerts': entry('[data-testid="obs-alerts-toggle"], button[title="Alert Rules"]'),
  'observability/timeline': entry('[data-testid="obs-view"] button:last-child, button[title="timeline_view"]'),
  // The full issue: the detail's Details button (pre-kit: a row click opened the modal).
  'observability/issue': entry('[data-testid="obs-issue-open"], [role="option"]'),
  // A row click: the detail in the pane or the drawer (pre-kit: the modal).
  'observability/select': entry('tr[data-testid="obs-issue-row"]:nth-child(2), [role="option"]:nth-child(2)'),
};
