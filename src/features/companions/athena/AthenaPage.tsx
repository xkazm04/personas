import { lazy, Suspense } from 'react';
import {
  ContentBox,
  ContentHeader,
  ContentBody,
} from '@/features/shared/components/layout/ContentLayout';
import { IconCompanion } from '@/features/plugins/PluginIcons';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import { useSystemStore } from '@/stores/systemStore';
import { athenaTabOfPage } from '../types';
import { useTranslation } from '@/i18n/useTranslation';
import { lazyRetry } from '@/lib/lazyRetry';

const CreateAthenaPanel = lazyRetry(() => import('./sub_create/CreateAthenaPanel'));
const SetupPanel = lazy(() => import('./sub_setup/SetupPanel'));
const MemoryPanel = lazy(() => import('./sub_memory/MemoryPanel'));
const VoicePanel = lazy(() => import('./sub_voice/VoicePanel'));
const DecisionsPanel = lazy(() => import('./sub_decisions/DecisionsPanel'));

/**
 * Athena's page — her manager surface inside the Companions section.
 *
 * Her five pages (Create Athena, Setup, Memory, Voice, Decisions) are rows in
 * `CompanionsSidebarNav`, and each is a `CompanionsPage` of the form
 * `athena:<tab>`. This page reads the tab half and renders one panel, which is
 * why the Companions router mounts it as ONE branch: switching between her
 * tabs never re-mounts her surface. (The former Dashboard tab was retired —
 * Cockpit is the dynamic dashboard surface now.)
 */
export default function AthenaPage() {
  const { t } = useTranslation();
  // The router only mounts this page for an `athena:*` destination, so the
  // fallback is unreachable in practice; Setup is her landing tab.
  const tab = useSystemStore((s) => athenaTabOfPage(s.companionsPage)) ?? 'setup';

  return (
    <ContentBox>
      <ContentHeader
        icon={<IconCompanion active className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title={t.athena.page_title}
        subtitle={t.athena.page_subtitle}
      />

      <ContentBody centered={tab !== 'memory'}>
        <div key={tab} className="animate-fade-slide-in h-full">
          <ErrorBoundary name="Companion">
            <Suspense fallback={<RouteChunkSkeleton />}>
              {tab === 'create-athena' && <CreateAthenaPanel />}
              {tab === 'setup' && <SetupPanel />}
              {tab === 'memory' && <MemoryPanel />}
              {tab === 'voice' && <VoicePanel />}
              {tab === 'decisions' && <DecisionsPanel />}
            </Suspense>
          </ErrorBoundary>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
