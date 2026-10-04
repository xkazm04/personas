/**
 * Overview > Observability, composed from the composition kit (`@/features/shared/components/kit`,
 * Spine & Lens, Gate K). TWO LEVELS since 2026-10-04 (the owner, walking the one long page):
 * "Design two level structure instead one long page ... Keeping first section with overview
 * stats ... Abstracting all sections below with cards and simple stat, on click expanding with
 * animated transition into nested levels".
 *
 * Layer 1 is the Overview section (filters and headline figures) and then one `Tiles` grid where
 * every other region is a pressable card carrying its own figure (`ObservabilityCards`). Layer 2
 * is the pressed region's own sections, rendered full width under the grid - full width because
 * four of the seven are chart- or table-shaped and a `Split` pane would squeeze a plot into a
 * third of the surface. Pressing the open card again returns to layer 1.
 *
 * NOT `KitHost compact` any more (doctrine 6c, 2026-10-03): a compact kit host renders every row
 * token 11.1-12.5% smaller than the same token outside the kit, and this is a diagnostic surface,
 * not a dense tool list. That single word was the whole of the owner's "typography size does not
 * reflect Appearance settings" report - the kit's tokens track the setting correctly, the density
 * tier was subtracting a step from all of them (scripts/style/kit-type-probe/).
 *
 * Routed since 2026-09-25 as an Overview tab: `overviewTab === 'observability'` in
 * src/features/overview/components/dashboard/OverviewPage.tsx (commit 0239ccde9). The style page
 * harness shoots it (scripts/style/page-harness, observability/*).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Stethoscope } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { KitHost, Surface } from '@/features/shared/components/kit';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useAiHealingStream } from '@/hooks/execution/useAiHealingStream';
import { useOverviewStore } from '@/stores/overviewStore';
import type { MetricAnomaly } from '@/lib/bindings/MetricAnomaly';
import { useObservabilityData } from '../libs/useObservabilityData';
import { useHealingPanelState } from '../libs/useHealingPanelState';
import { useAnomalyDrilldown } from '../libs/useAnomalyDrilldown';
import { useAthenaHealth } from '../libs/useAthenaHealth';
import { useToolPerformance } from '../libs/useToolPerformance';
import { useObservabilityWords, type RegionId } from '../libs/useObservabilityWords';
import { ObservabilityOverview } from './ObservabilityOverview';
import { ObservabilityCards } from './ObservabilityCards';
import { AlertRulesPanel } from './AlertRulesPanel';
import { AlertHistoryPanel } from './AlertHistoryPanel';
import { HealingIssuesPanel } from './HealingIssuesPanel';
import { MetricsCharts } from './MetricsCharts';
import IpcPerformancePanel from './IpcPerformancePanel';
import { ToolPerformanceSection } from './ToolPerformanceSection';
import SystemTraceViewer from './SystemTraceViewer';
import { AthenaHealthPanel } from './AthenaHealthPanel';
import { AiHealingStreamOverlay } from './AiHealingStreamOverlay';
import HealingIssueModal from './HealingIssueModal';
import AnomalyDrilldownPanel from './AnomalyDrilldownPanel';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function ObservabilityDashboard() {
  const w = useObservabilityWords();
  const d = useObservabilityData();
  const [open, setOpen] = useState<RegionId | null>(null);
  // useShallow: an inline-object selector returned a new ref per snapshot (getSnapshot loop).
  const { pipelineErrors, pipelineFetchedAt } = useOverviewStore(useShallow((s) => ({
    pipelineErrors: s.pipelineErrors,
    pipelineFetchedAt: s.pipelineFetchedAt,
  })));
  const drilldown = useAnomalyDrilldown();

  // On "All personas" the healing analysis runs against personas[0], so the stream subscribes
  // to the same persona (it listened on '' and never surfaced the running healing).
  const aiHealing = useAiHealingStream(d.selectedPersonaId ?? d.personas[0]?.id ?? '');
  const [healingDismissed, setHealingDismissed] = useState(false);
  const showHealingOverlay = aiHealing.phase !== 'idle' && !healingDismissed;
  useEffect(() => {
    if (aiHealing.phase === 'started') setHealingDismissed(false);
  }, [aiHealing.phase]);

  const healing = useHealingPanelState({
    healingIssues: d.healingIssues,
    triggerHealing: d.triggerHealing,
    selectedPersonaId: d.selectedPersonaId,
    personas: d.personas,
    fetchHealingTimeline: d.fetchHealingTimeline,
  });

  const handleFailureBarClick = useCallback((date: string) => {
    d.setFailureDrilldownDate(date);
    // The failed runs live on the Activity tab (the Extracted tab was retired 2026-08-26).
    d.setOverviewTab('executions');
  }, [d]);
  const handleAnomalyClick = useCallback((anomaly: MetricAnomaly) => {
    drilldown.openDrilldown(anomaly, d.selectedPersonaId);
  }, [drilldown, d.selectedPersonaId]);
  // Memoised: a fresh ISO string per render re-ran the tool fetch on every render.
  const since = useMemo(() => new Date(Date.now() - d.days * DAY_MS).toISOString(), [d.days]);

  // Read once here, handed to the card AND to its level-2 section: the card's figure must not be
  // a second read of the same command, and the card must not wait on the section to find out.
  const tools = useToolPerformance(since, d.selectedPersonaId ?? undefined);
  const athena = useAthenaHealth();

  // The healing issues are fetched by the dashboard pipeline, not by this tab, so the only honest
  // in-flight signal is the pipeline's own bookkeeping: `healingIssues` has neither a success
  // stamp nor a recorded error yet (overviewSlice.runDashboardWave2 writes one or the other).
  const issuesLoading = pipelineFetchedAt.healingIssues === undefined && pipelineErrors.healingIssues === undefined;
  const metricsLoading = !d.summary && !d.observabilityError;
  // The worst day in the window: what the cost chart a level down is actually about.
  const peakDayCost = useMemo(
    () => (d.chartData.length === 0 ? null : d.chartData.reduce((m, p) => Math.max(m, p.cost), 0)),
    [d.chartData],
  );

  const toggle = useCallback((id: RegionId) => setOpen((cur) => (cur === id ? null : id)), []);

  /**
   * The expansion's entrance. `RevealItem` is the repo's entrance vocabulary and owns the
   * reduced-motion branch: with `prefers-reduced-motion` it renders the SAME element with no
   * animation class and no delay, which is byte-identical to the already-expanded render - one
   * code path, not a parallel implementation. The tracker is component-local and keyed on the
   * open region, so each press plays once and a poll, a refresh or a filter change inside the
   * open region replays nothing (the id is already marked entered under the same key).
   */
  const enter = useRevealTracker(open ?? '');

  let detail: ReactNode;
  switch (open) {
    case 'health':
      detail = (
        <HealingIssuesPanel
          healingIssues={d.healingIssues}
          healingRunning={d.healingRunning}
          handleRunAnalysis={healing.handleRunAnalysis}
          resolveHealingIssue={d.resolveHealingIssue}
          setSelectedIssue={healing.setSelectedIssue}
          issueFilter={healing.issueFilter}
          setIssueFilter={healing.setIssueFilter}
          issueCounts={healing.issueCounts}
          sortedFilteredIssues={healing.sortedFilteredIssues}
          analysisResult={healing.analysisResult}
          setAnalysisResult={() => healing.setAnalysisResult(null)}
          analysisError={healing.analysisError}
          setAnalysisError={() => healing.setAnalysisError(null)}
          viewMode={healing.healingViewMode}
          setViewMode={healing.setHealingViewMode}
          timelineEvents={d.healingTimeline}
          timelineLoading={d.healingTimelineLoading}
          issuesLoading={issuesLoading}
          selectedPersonaId={d.selectedPersonaId}
          personas={d.personas}
          w={w}
        />
      );
      break;
    case 'charts':
      detail = (
        <MetricsCharts
          loading={metricsLoading}
          chartData={d.chartData}
          pieData={d.pieData}
          anomalies={d.chartAnomalies}
          annotations={d.chartAnnotations}
          onFailureBarClick={handleFailureBarClick}
          onAnomalyClick={handleAnomalyClick}
        />
      );
      break;
    case 'alerts':
      detail = <><AlertRulesPanel /><AlertHistoryPanel /></>;
      break;
    case 'ipc':
      detail = <IpcPerformancePanel />;
      break;
    case 'tools':
      detail = <ToolPerformanceSection perf={tools} />;
      break;
    case 'traces':
      detail = <SystemTraceViewer />;
      break;
    case 'athena':
      detail = <AthenaHealthPanel health={athena.data} loading={athena.loading} />;
      break;
    default:
      detail = null;
  }

  return (
    <ContentBox>
      <ContentHeader
        icon={<Stethoscope className="w-5 h-5 text-primary" />}
        title={w.o.observability.title}
        subtitle={w.o.observability.subtitle}
      />
      <ContentBody>
        <KitHost testId="observability-surface">
          <Surface dense>
            <ObservabilityOverview
              d={d} w={w}
              pipelineErrors={pipelineErrors} pipelineFetchedAt={pipelineFetchedAt}
            />
            <ObservabilityCards
              open={open}
              onOpen={toggle}
              w={w}
              issues={d.healingIssues}
              issuesLoading={issuesLoading}
              peakCost={peakDayCost}
              failed={d.summary?.failedExecutions ?? 0}
              anomalies={d.chartAnomalies.filter((a) => a.metric === 'cost').length}
              metricsLoading={metricsLoading}
              tools={tools}
              athena={athena}
            />
            {open !== null && detail !== null && (
              <RevealItem
                revealId={open}
                hasEntered={enter.hasEntered}
                markEntered={enter.markEntered}
                data-testid="obs-level2"
              >
                {detail}
              </RevealItem>
            )}
          </Surface>
        </KitHost>
        {showHealingOverlay && <AiHealingStreamOverlay healing={aiHealing} onDismiss={() => setHealingDismissed(true)} />}
      </ContentBody>

      {healing.selectedIssue && (
        <HealingIssueModal issue={healing.selectedIssue} onResolve={(id) => d.resolveHealingIssue(id)} onClose={() => healing.setSelectedIssue(null)} />
      )}
      {drilldown.selectedAnomaly && (
        <AnomalyDrilldownPanel
          anomaly={drilldown.selectedAnomaly}
          data={drilldown.drilldownData}
          loading={drilldown.loading}
          error={drilldown.error}
          onClose={drilldown.closeDrilldown}
        />
      )}
    </ContentBox>
  );
}
