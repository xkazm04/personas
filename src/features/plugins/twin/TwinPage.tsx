import { lazy, Suspense, useEffect, useRef } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { TwinSelector } from './TwinSelector';
import { useHydrateActiveTwin } from './useTwinReadiness';

const ProfilesPage = lazy(() => import('./sub_profiles/ProfilesPage'));
const IdentityPage = lazy(() => import('./sub_identity/IdentityPage'));
const TonePage = lazy(() => import('./sub_tone/TonePage'));
const BrainPage = lazy(() => import('./sub_brain/BrainPage'));
const KnowledgePage = lazy(() => import('./sub_knowledge/KnowledgePage'));
const VoicePage = lazy(() => import('./sub_voice/VoicePage'));
const ChannelsPage = lazy(() => import('./sub_channels/ChannelsPage'));
const TrainingPage = lazy(() => import('./sub_training/TrainingPage'));

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

  // If the user lands on a subpage but has no twin yet, bounce them to
  // Profiles so the selector banner's CTA matches the page they see.
  useEffect(() => {
    if (twinProfiles.length === 0 && twinTab !== 'profiles') {
      setTwinTab('profiles');
    }
  }, [twinProfiles.length, twinTab, setTwinTab]);

  return (
    <div className="h-full w-full flex flex-col">
      <TwinSelector />
      <div
        data-testid="twin-page"
        key={twinTab}
        className="animate-fade-slide-in flex-1 min-h-0 flex flex-col"
      >
        <Suspense fallback={<SuspenseFallback />}>
          {twinTab === 'profiles' && <ProfilesPage />}
          {twinTab === 'identity' && <IdentityPage />}
          {twinTab === 'tone' && <TonePage />}
          {twinTab === 'brain' && <BrainPage />}
          {twinTab === 'knowledge' && <KnowledgePage />}
          {twinTab === 'voice' && <VoicePage />}
          {twinTab === 'channels' && <ChannelsPage />}
          {twinTab === 'training' && <TrainingPage />}
        </Suspense>
      </div>
    </div>
  );
}
