import { lazy, Suspense } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';

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

  return (
    <div className="h-full w-full flex flex-col">
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
