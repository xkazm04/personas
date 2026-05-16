import { lazy, Suspense } from 'react';
import {
  Bot,
  Brain,
  LayoutDashboard,
  Mic,
  ScrollText,
  Settings,
} from 'lucide-react';
import {
  ContentBox,
  ContentHeader,
  ContentBody,
} from '@/features/shared/components/layout/ContentLayout';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { CompanionPluginTab } from '@/stores/slices/system/companionPluginSlice';

const SetupPanel = lazy(() => import('./sub_setup/SetupPanel'));
const MemoryPanel = lazy(() => import('./sub_memory/MemoryPanel'));
const VoicePanel = lazy(() => import('./sub_voice/VoicePanel'));
const DashboardPanel = lazy(() => import('./sub_dashboard/DashboardPanel'));
const DecisionsPanel = lazy(() => import('./sub_decisions/DecisionsPanel'));

/**
 * Companion plugin page — three-tab manager surface for Athena.
 *
 * - Setup:   global toggles (footer icon visibility, chime on/off, beta flag).
 * - Memory:  full-page brain viewer over the same store the chat brain uses.
 * - Voice:   ElevenLabs credential picker + voice-id binding (playback in
 *            chat is downstream).
 *
 * Layout matches Obsidian Brain: tab pills in the header actions, lazy-
 * loaded panel below.
 */
export default function CompanionPluginPage() {
  const { t } = useTranslation();
  const tab = useSystemStore((s) => s.companionPluginTab);
  const setTab = useSystemStore((s) => s.setCompanionPluginTab);

  const tabs: {
    id: CompanionPluginTab;
    label: string;
    icon: typeof Bot;
  }[] = [
    { id: 'setup', label: t.plugins.companion.tab_setup, icon: Settings },
    { id: 'memory', label: t.plugins.companion.tab_memory, icon: Brain },
    { id: 'voice', label: t.plugins.companion.tab_voice, icon: Mic },
    { id: 'dashboard', label: t.plugins.companion.tab_dashboard, icon: LayoutDashboard },
    { id: 'decisions', label: t.plugins.companion.tab_decisions, icon: ScrollText },
  ];

  return (
    <ContentBox>
      <ContentHeader
        icon={<Bot className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title={t.plugins.companion.page_title}
        subtitle={t.plugins.companion.page_subtitle}
        actions={
          <div className="flex items-center gap-1">
            {tabs.map((tabDef) => {
              const Icon = tabDef.icon;
              return (
                <button
                  key={tabDef.id}
                  onClick={() => setTab(tabDef.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-card typo-caption font-medium transition-colors focus-ring ${
                    tab === tabDef.id
                      ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25'
                      : 'text-foreground hover:bg-secondary/40 hover:text-foreground/80 border border-transparent'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tabDef.label}
                </button>
              );
            })}
          </div>
        }
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
            {tab === 'dashboard' && <DashboardPanel />}
            {tab === 'decisions' && <DecisionsPanel />}
          </Suspense>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
