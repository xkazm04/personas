import { lazy, Suspense } from 'react';
import { Terminal } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';

const FleetGridPage = lazy(() => import('./sub_grid/FleetGridPage'));
const FleetDecisionsPage = lazy(() => import('./sub_decisions/FleetDecisionsPage'));
const FleetSettingsPage = lazy(() => import('./sub_settings/FleetSettingsPage'));

export default function FleetPage() {
  const fleetTab = useSystemStore((s) => s.fleetTab);

  return (
    <div className="h-full w-full flex flex-col">
      <div
        data-testid="fleet-page"
        key={fleetTab}
        className="animate-fade-slide-in flex-1 min-h-0 flex flex-col"
      >
        <Suspense fallback={<SuspenseFallback />}>
          {fleetTab === 'grid' && <FleetGridPage />}
          {fleetTab === 'decisions' && <FleetDecisionsPage />}
          {fleetTab === 'settings' && <FleetSettingsPage />}
        </Suspense>
      </div>
    </div>
  );
}

// Lightweight banner shown on every sub-page while phases 1-9 are still wiring up.
export function FleetPhaseBanner({ phase, summary }: { phase: string; summary: string }) {
  return (
    <ContentBox>
      <ContentHeader
        icon={<Terminal className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Fleet — Claude Code session aggregator"
        subtitle="Experimental plugin (DEV builds only)"
      />
      <ContentBody>
        <div className="border border-amber-500/25 rounded-modal bg-amber-500/5 px-4 py-3">
          <p className="typo-caption font-medium text-amber-400 mb-1">{phase}</p>
          <p className="text-[12px] text-foreground/80 leading-relaxed">{summary}</p>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
