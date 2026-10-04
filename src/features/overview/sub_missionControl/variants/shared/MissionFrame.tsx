// The chrome every variant keeps from MissionControlHome, unchanged in
// behaviour: the header with customize / range / persona filter, the pipeline
// error banners with their dismissal, and the settled-empty gate (the
// `678ee0eae` reasoning: "nothing here" only once the fetch KNOWS it).
// The body below is the variant's; it gets the full height of the content
// region, without the page scroll (layer 1 is one window).

import { useMemo, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { useAuthStore } from '@/stores/authStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useOverviewFilterValues, useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { HeroMesh } from '@/features/shared/components/display/HeroMesh';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { StalenessIndicator } from '@/features/shared/components/feedback/StalenessIndicator';
import { DashboardRangeSwitch } from '@/features/overview/components/dashboard/widgets/DashboardRangeSwitch';
import { DashboardEmptyState } from '@/features/overview/components/dashboard/DashboardEmptyState';
import { HomeCustomizePopover } from '@/features/overview/components/dashboard/HomeCustomizePopover';
import './mission.css';

export function MissionFrame({ children, testId }: { children: ReactNode; testId: string }) {
  const { t, tx } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const personas = useAgentStore((s) => s.personas);
  const personasLoading = useAgentStore((s) => s.isLoading);
  const { globalExecutions, pipelineErrors, pipelineFetchedAt, setPipelineError } = useOverviewStore(useShallow((s) => ({
    globalExecutions: s.globalExecutions,
    pipelineErrors: s.pipelineErrors,
    pipelineFetchedAt: s.pipelineFetchedAt,
    setPipelineError: s.setPipelineError,
  })));
  const { selectedPersonaId } = useOverviewFilterValues();
  const { setSelectedPersonaId } = useOverviewFilterActions();

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t.overview.dashboard.greeting_morning;
    if (hour < 18) return t.overview.dashboard.greeting_afternoon;
    return t.overview.dashboard.greeting_evening;
  }, [t]);
  const displayName = user?.display_name || user?.email?.split('@')[0] || t.overview.dashboard.default_user;

  // Same settled gate as MissionControlHome: the empty state is a CLAIM and
  // may only render once both halves of "nothing recorded" have settled.
  const executionsSettled = pipelineFetchedAt.globalExecutions !== undefined || pipelineErrors.globalExecutions !== undefined;
  const knownEmpty = executionsSettled && !personasLoading && personas.length === 0 && globalExecutions.length === 0;
  const errors = Object.entries(pipelineErrors);

  return (
    <ContentBox data-testid={testId}>
      <HeroMesh preset="dashboard" />
      <ContentHeader
        title={t.overview.dashboard.mission_control_eyebrow}
        subtitle={`${greeting}, ${displayName}`}
        actions={
          <div className="flex items-center gap-2">
            <HomeCustomizePopover />
            <DashboardRangeSwitch />
            <PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />
          </div>
        }
      />
      <div className="mc-body">
        {errors.length > 0 && (
          <div className="mc-banners">
            {errors.map(([source, msg]) => (
              <InlineErrorBanner
                key={source}
                severity="warning"
                compact
                title={tx(t.overview.dashboard.pipeline_failed, { source })}
                message={msg}
                onDismiss={() => setPipelineError(source, null)}
                actions={<StalenessIndicator fetchedAt={pipelineFetchedAt[source]} hasError label={source} />}
              />
            ))}
          </div>
        )}
        {knownEmpty ? <div className="mc-empty"><DashboardEmptyState /></div> : children}
      </div>
    </ContentBox>
  );
}
