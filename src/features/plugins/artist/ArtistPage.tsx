import { lazy, Suspense } from 'react';
import { Palette } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';

const CreativeStudioPanel = lazy(() => import('./sub_blender/CreativeStudioPanel'));
const GalleryPage = lazy(() => import('./sub_gallery/GalleryPage'));
const MediaStudioPage = lazy(() => import('./sub_media_studio/MediaStudioPage'));

/**
 * Artist plugin shell. Sub-tabs (blender / gallery / media-studio) are
 * driven by `artistTab` in systemStore and presented as second-level
 * sidebar entries under "Artist" in PluginsSidebarNav — mirroring the
 * Dev Tools pattern. The shared ContentHeader stays mounted across
 * subtab switches; the subtitle changes to reflect the active surface.
 */
export default function ArtistPage() {
  const { t } = useTranslation();
  const artistTab = useSystemStore((s) => s.artistTab);

  const subtitle =
    artistTab === 'media-studio' ? t.plugins.artist.tab_media_studio :
    artistTab === 'gallery' ? t.plugins.artist.tab_gallery :
    t.plugins.artist.tab_creative_studio;

  const header = (
    <ContentHeader
      icon={<Palette className="w-5 h-5 text-rose-400" />}
      iconColor="red"
      title={t.plugins.artist.title}
      subtitle={subtitle}
    />
  );

  if (artistTab === 'media-studio') {
    return (
      <ContentBox>
        {header}
        <ContentBody flex noPadding>
          <div
            key={artistTab}
            data-testid="artist-page-media-studio"
            className="animate-fade-slide-in flex-1 flex flex-col min-h-0"
          >
            <Suspense fallback={null}>
              <MediaStudioPage />
            </Suspense>
          </div>
        </ContentBody>
      </ContentBox>
    );
  }

  return (
    <ContentBox>
      {header}
      <ContentBody centered>
        <div
          key={artistTab}
          data-testid={`artist-page-${artistTab}`}
          className="animate-fade-slide-in"
        >
          <Suspense fallback={null}>
            {artistTab === 'blender' && <CreativeStudioPanel />}
            {artistTab === 'gallery' && <GalleryPage />}
          </Suspense>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
