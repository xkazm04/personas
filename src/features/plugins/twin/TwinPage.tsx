import { lazy, Suspense, useEffect, useRef } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import type { TwinRetiredTab, TwinRoutedTab, TwinTab } from '@/lib/types/types';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useHydrateActiveTwin } from './useTwinReadiness';
import { useReadinessCelebration } from './useReadinessCelebration';

// Mirrors ContentBox's responsive ladder (see ContentLayout.tsx). Twin
// Atelier pages render their own hero band instead of ContentHeader, so
// the ladder lives here to give every Twin subpage the same width
// contract Overview pages get for free.
const TWIN_PAGE_MIN_WIDTH = IS_MOBILE
  ? ''
  : 'min-w-[640px] md:min-w-[800px] xl:min-w-[920px] 2xl:min-w-[1180px] 3xl:min-w-[1560px] 4xl:min-w-[2200px]';

const ProfilesPage = lazy(() => import('./sub_profiles/ProfilesPage'));
const SetupPage = lazy(() => import('./setup/SetupPage'));
const HubPage = lazy(() => import('./hub/HubPage'));

/** The three tabs this page renders. Anything else is redirected, never shown. */
const ROUTED_TABS: readonly TwinRoutedTab[] = ['profiles', 'setup', 'hub'];

/**
 * Where each retired tab id lands. The seven-tab Twin was folded into three on
 * 2026-09-16; a persisted `twinTab`, a deep link, or one of the still-on-disk
 * `sub_*` pages can all still hand us an old id, and every one of them has a
 * successor. Rendering nothing (what an unhandled id used to do) is the failure
 * this table exists to prevent.
 */
const RETIRED_TAB_DESTINATION: Record<TwinRetiredTab, TwinRoutedTab> = {
  identity: 'setup',
  tone: 'setup',
  channels: 'setup',
  training: 'setup',
  brain: 'hub',
  knowledge: 'hub',
};

function isRouted(tab: TwinTab): tab is TwinRoutedTab {
  return (ROUTED_TABS as readonly string[]).includes(tab);
}

export default function TwinPage() {
  const twinTab = useSystemStore((s) => s.twinTab);
  const setTwinTab = useSystemStore((s) => s.setTwinTab);
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const fetchTwinProfiles = useSystemStore((s) => s.fetchTwinProfiles);
  const loadedRef = useRef(false);

  // Hydrate profiles once on first mount so the selector + sub-tab guards
  // have data to reason about. Subpages still re-fetch what they need.
  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      void fetchTwinProfiles();
    }
  }, [fetchTwinProfiles]);

  // Hydrate all per-twin layers (tones/channels/voice/memories) whenever
  // the active twin changes — so the progress strip + readiness score in
  // the selector banner stay accurate regardless of which subtab is open.
  useHydrateActiveTwin();

  // Celebrate when the active twin's readiness climbs (a milestone just closed).
  useReadinessCelebration();

  // If the user lands on a subpage but has no twin yet, bounce them to
  // Profiles so the selector banner's CTA matches the page they see.
  useEffect(() => {
    if (twinProfiles.length === 0 && twinTab !== 'profiles') {
      setTwinTab('profiles');
    }
  }, [twinProfiles.length, twinTab, setTwinTab]);

  // Redirect a retired id to its successor, and recover an unknown one to
  // Profiles. The sidebar selects via `id as TwinTab` (PluginsSidebarNav.tsx),
  // so a nav id with no branch below type-checks fine and silently renders
  // nothing — which is exactly what a retired 'voice' item did until
  // 2026-07-27, and what six retired ids would do from 2026-09-16.
  useEffect(() => {
    if (isRouted(twinTab)) return;
    // The `??` is a runtime backstop, not dead code: the type says every
    // non-routed id is a retired one, but persisted state predates the type.
    setTwinTab(RETIRED_TAB_DESTINATION[twinTab] ?? 'profiles');
  }, [twinTab, setTwinTab]);

  return (
    <div className="h-full w-full flex flex-col">
      <div
        data-testid="twin-page"
        key={twinTab}
        className={`animate-fade-slide-in flex-1 min-h-0 flex flex-col w-full overflow-hidden ${TWIN_PAGE_MIN_WIDTH}`}
      >
        <Suspense fallback={<RouteChunkSkeleton />}>
          {twinTab === 'profiles' && <ProfilesPage />}
          {twinTab === 'setup' && <SetupPage />}
          {twinTab === 'hub' && <HubPage />}
        </Suspense>
      </div>
    </div>
  );
}
