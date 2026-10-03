/**
 * Overview > Observability, composed from the composition kit (`@/features/shared/components/kit`,
 * Spine & Lens, Gate K) the way Fleet Activity is: one KitHost on the compact tier, one dense
 * Surface, every part a Section on the spine. Order: Overview (filters and headline figures),
 * the alert rules and history when toggled, Health Issues (the working list, with its detail
 * pane), the trend charts and per-persona split, IPC and tool performance, system traces,
 * Athena's health and spend.
 *
 * Routed since 2026-09-25 as an Overview tab: `overviewTab === 'observability'` in
 * src/features/overview/components/dashboard/OverviewPage.tsx (commit 0239ccde9). It was
 * unmounted before; the style page harness still shoots it (scripts/style/page-harness,
 * observability/*).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Stethoscope } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { KitHost, Surface } from '@/features/shared/components/kit';
import { useAiHealingStream } from '@/hooks/execution/useAiHealingStream';
import { useOverviewStore } from '@/stores/overviewStore';
import { useAttention } from '@/hooks/useAttention';
import type { MetricAnomaly } from '@/lib/bindings/MetricAnomaly';
import { useObservabilityData } from '../libs/useObservabilityData';
import { useHealingPanelState } from '../libs/useHealingPanelState';
import { useAnomalyDrilldown } from '../libs/useAnomalyDrilldown';
import { useObservabilityWords } from '../libs/useObservabilityWords';
import { ObservabilityOverview } from './ObservabilityOverview';
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
  const [showAlerts, setShowAlerts] = useState(false);
  const activeAlertCount = useAttention('observability').counts.active_alerts;
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
  const eyebrow = w.eyebrow;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Stethoscope className="w-5 h-5 text-primary" />}
        title={w.o.observability.title}
        subtitle={w.o.observability.subtitle}
      />
      <ContentBody>
        <KitHost compact testId="observability-surface">
          <Surface dense>
            <ObservabilityOverview
              d={d} w={w}
              showAlerts={showAlerts} onToggleAlerts={() => setShowAlerts((v) => !v)} activeAlertCount={activeAlertCount}
              pipelineErrors={pipelineErrors} pipelineFetchedAt={pipelineFetchedAt}
            />
            {showAlerts && (
              <>
                <AlertRulesPanel eyebrow={eyebrow} />
                <AlertHistoryPanel eyebrow={eyebrow} />
              </>
            )}
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
              // The healing issues are fetched by the dashboard pipeline, not by
              // this tab, so the only honest in-flight signal is the pipeline's
              // own bookkeeping: `healingIssues` has neither a success stamp nor
              // a recorded error yet (overviewSlice.runDashboardWave2 writes one
              // or the other for every source).
              issuesLoading={pipelineFetchedAt.healingIssues === undefined && pipelineErrors.healingIssues === undefined}
              selectedPersonaId={d.selectedPersonaId}
              personas={d.personas}
              w={w}
            />
            <MetricsCharts
              eyebrow={eyebrow}
              loading={!d.summary && !d.observabilityError}
              chartData={d.chartData}
              pieData={d.pieData}
              anomalies={d.chartAnomalies}
              annotations={d.chartAnnotations}
              onFailureBarClick={handleFailureBarClick}
              onAnomalyClick={handleAnomalyClick}
            />
            <IpcPerformancePanel eyebrow={eyebrow} />
            <ToolPerformanceSection since={since} personaId={d.selectedPersonaId ?? undefined} eyebrow={eyebrow} />
            <SystemTraceViewer eyebrow={eyebrow} />
            <AthenaHealthPanel eyebrow={eyebrow} />
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
