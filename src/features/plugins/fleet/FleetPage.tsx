import { lazy, Suspense, useState } from 'react';
import { Terminal, LayoutDashboard, MessageSquare, Settings as SettingsIcon } from 'lucide-react';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';

const FleetGridPage = lazy(() => import('./sub_grid/FleetGridPage'));
const FleetDecisionsPage = lazy(() => import('./sub_decisions/FleetDecisionsPage'));
const FleetSettingsPage = lazy(() => import('./sub_settings/FleetSettingsPage'));

type InternalTab = 'grid' | 'decisions' | 'settings';

const TABS: { id: InternalTab; label: string; icon: typeof Terminal }[] = [
  { id: 'grid', label: 'Sessions', icon: LayoutDashboard },
  { id: 'decisions', label: 'Decisions', icon: MessageSquare },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

/**
 * Fleet — Claude Code session aggregator, rendered as a Dev Tools sub-tab.
 *
 * Three internal tabs (Sessions / Decisions / Settings) live inside one
 * Dev Tools slot rather than expanding the dev-tools sidebar by three
 * entries. The active project (from the dev-tools project picker) is the
 * implicit cwd for any session spawned here.
 */
export default function FleetPage() {
  const [tab, setTab] = useState<InternalTab>('grid');

  return (
    <div className="h-full w-full flex flex-col" data-testid="fleet-page">
      {/* Internal tab strip — lightweight band above the active sub-page;
          each sub-page renders its own ContentBox/Header underneath. */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-primary/5">
        <Terminal className="w-4 h-4 text-amber-400 mr-2" />
        <span className="typo-caption font-semibold text-foreground mr-3">Fleet</span>
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              data-testid={`fleet-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-card text-[12px] transition-colors ${
                active
                  ? 'bg-amber-500/10 text-amber-300 border border-amber-500/25'
                  : 'text-foreground/60 hover:text-foreground hover:bg-secondary/40 border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        data-testid={`fleet-active-${tab}`}
        key={tab}
        className="animate-fade-slide-in flex-1 min-h-0 flex flex-col"
      >
        <Suspense fallback={<SuspenseFallback />}>
          {tab === 'grid' && <FleetGridPage />}
          {tab === 'decisions' && <FleetDecisionsPage />}
          {tab === 'settings' && <FleetSettingsPage />}
        </Suspense>
      </div>
    </div>
  );
}

// Retained for the three sub_*/page modules that still import it as a
// placeholder. Used only when a sub-page wants to surface "this surface
// isn't fully wired yet" while iterating; harmless to keep.
export function FleetPhaseBanner({ phase, summary }: { phase: string; summary: string }) {
  return (
    <ContentBox>
      <ContentHeader
        icon={<Terminal className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Fleet — Claude Code session aggregator"
        subtitle="Experimental — lives under Dev Tools, inherits the active project"
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
