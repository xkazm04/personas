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

/**
 * Clicks each selector in turn once it exists (polled for up to 5 s each). StrictMode-safe.
 * A sequence exists because the surface is two-level since 2026-10-04: a control inside a
 * region can only be reached after that region's layer-1 card has been pressed open.
 */
function ClickWhenReady({ selectors, children }: { selectors: readonly string[]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || root.dataset.driven) return;
    root.dataset.driven = '1';
    let step = 0;
    let tries = 0;
    const tick = () => {
      const selector = selectors[step];
      if (selector === undefined) return;
      const el = root.querySelector<HTMLElement>(selector);
      if (el) { el.click(); step += 1; tries = 0; setTimeout(tick, 50); return; }
      if (tries++ < 100) setTimeout(tick, 50);
    };
    tick();
  }, [selectors]);
  return <div ref={ref} className="contents">{children}</div>;
}

const dashboard = () => import('@/features/overview/sub_observability/components/ObservabilityDashboard') as Promise<{ default: ComponentType }>;

function page(clicks: readonly string[]) {
  return async (): Promise<{ default: ComponentType }> => {
    const { default: Page } = await dashboard();
    return {
      default: function ObservabilityHost() {
        return clicks.length > 0 ? <ClickWhenReady selectors={clicks}><Page /></ClickWhenReady> : <Page />;
      },
    };
  };
}

const providers = async () => {
  const { OverviewFilterProvider } = await import('@/features/overview/components/dashboard/OverviewFilterContext');
  return (children: ReactNode) => <OverviewFilterProvider>{children}</OverviewFilterProvider>;
};

const entry = (...clicks: string[]): HarnessModule => ({ load: page(clicks), providers, prepare: prepareObservability });

/**
 * Layer-1 card presses. Each is listed first so the same entry works before and after the
 * two-level rework: on the one-level page the card does not exist, the poll times out, and
 * the next selector in the sequence is tried against the section that was always on screen.
 */
const OPEN_HEALTH = '[data-testid="obs-card-health"] button';
const OPEN_ALERTS = '[data-testid="obs-card-alerts"] button, [data-testid="obs-alerts-toggle"], button[title="Alert Rules"]';
const OPEN_CHARTS = '[data-testid="obs-card-charts"] button';

export const OBSERVABILITY_MODULES: Record<string, HarnessModule> = {
  'observability/dashboard': entry(),
  'observability/alerts': entry(OPEN_ALERTS),
  'observability/charts': entry(OPEN_CHARTS),
  'observability/timeline': entry(OPEN_HEALTH, '[data-testid="obs-view"] button:last-child, button[title="timeline_view"]'),
  // The full issue: the detail's Details button (pre-kit: a row click opened the modal).
  'observability/issue': entry(OPEN_HEALTH, '[data-testid="obs-issue-open"], [role="option"]'),
  // A row click: the detail in the pane or the drawer (pre-kit: the modal).
  'observability/select': entry(OPEN_HEALTH, 'tr[data-testid="obs-issue-row"]:nth-child(2), [role="option"]:nth-child(2)'),
};
