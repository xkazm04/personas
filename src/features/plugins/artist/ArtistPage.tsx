import { lazy, Suspense } from 'react';
import { Palette, Wand2, Image, Film } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import type { ArtistTab } from '@/lib/types/types';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

const CreativeStudioPanel = lazy(() => import('./sub_blender/CreativeStudioPanel'));
const GalleryPage = lazy(() => import('./sub_gallery/GalleryPage'));
const MediaStudioPage = lazy(() => import('./sub_media_studio/MediaStudioPage'));

export default function ArtistPage() {
  const { t } = useTranslation();

  const tabs: { id: ArtistTab; label: string; icon: typeof Palette }[] = [
    { id: 'blender', label: t.plugins.artist.tab_creative_studio, icon: Wand2 },
    { id: 'gallery', label: t.plugins.artist.tab_gallery, icon: Image },
    { id: 'media-studio', label: t.plugins.artist.tab_media_studio, icon: Film },
  ];
  const artistTab = useSystemStore((s) => s.artistTab);
  const setArtistTab = useSystemStore((s) => s.setArtistTab);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Palette className="w-5 h-5 text-rose-400" />}
        iconColor="red"
        title={t.plugins.artist.title}
        subtitle={t.plugins.artist.subtitle}
        actions={
          <div className="flex items-center gap-1">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setArtistTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg typo-heading transition-colors ${
                    artistTab === t.id
                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground border border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        }
      />

      {artistTab === 'media-studio' ? (
        <ContentBody flex noPadding>
          <div key={artistTab} className="animate-fade-slide-in flex-1 flex flex-col min-h-0">
            <Suspense fallback={null}>
              <MediaStudioPage />
            </Suspense>
          </div>
        </ContentBody>
      ) : (
        <ContentBody centered>
          <div key={artistTab} className="animate-fade-slide-in">
            <Suspense fallback={null}>
              {artistTab === 'blender' && <CreativeStudioPanel />}
              {artistTab === 'gallery' && <GalleryPage />}
            </Suspense>
          </div>
        </ContentBody>
      )}
    </ContentBox>
  );
}
