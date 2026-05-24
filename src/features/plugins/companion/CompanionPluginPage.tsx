import { lazy, Suspense } from 'react';
import { Bot } from 'lucide-react';
import {
  ContentBox,
  ContentHeader,
  ContentBody,
} from '@/features/shared/components/layout/ContentLayout';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

const SetupPanel = lazy(() => import('./sub_setup/SetupPanel'));
const MemoryPanel = lazy(() => import('./sub_memory/MemoryPanel'));
const VoicePanel = lazy(() => import('./sub_voice/VoicePanel'));
const DecisionsPanel = lazy(() => import('./sub_decisions/DecisionsPanel'));

/**
 * Companion plugin page — manager surface for Athena.
 *
 * Sub-tabs (Setup, Memory, Voice, Decisions) live in the L3 sidebar (see
 * `companionItems` in sidebarData.ts); the page only renders the active
 * panel. (The former Dashboard tab was retired — Cockpit is the dynamic
 * dashboard surface now.)
 */
export default function CompanionPluginPage() {
  const { t } = useTranslation();
  const tab = useSystemStore((s) => s.companionPluginTab);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Bot className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title={t.plugins.companion.page_title}
        subtitle={t.plugins.companion.page_subtitle}
      />

      <ContentBody centered={tab !== 'memory'}>
        <div key={tab} className="animate-fade-slide-in h-full">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-20">
                <LoadingSpinner size="lg" label={t.plugins.companion.loading} />
              </div>
            }
          >
            {tab === 'setup' && <SetupPanel />}
            {tab === 'memory' && <MemoryPanel />}
            {tab === 'voice' && <VoicePanel />}
            {tab === 'decisions' && <DecisionsPanel />}
          </Suspense>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
