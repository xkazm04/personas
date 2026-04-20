import { lazy, Suspense } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBody, ContentBox } from '@/features/shared/components/layout/ContentLayout';

const CreativeStudioPanel = lazy(() => import('./sub_blender/CreativeStudioPanel'));
const GalleryPage = lazy(() => import('./sub_gallery/GalleryPage'));
const MediaStudioPage = lazy(() => import('./sub_media_studio/MediaStudioPage'));

/**
 * Artist plugin shell. Sub-tabs (blender / gallery / media-studio) are
 * driven by `artistTab` in systemStore and presented as second-level
 * sidebar entries under "Artist" in PluginsSidebarNav — mirroring the
 * Dev Tools pattern. This component no longer renders its own header or
 * tab strip; the Media Studio in particular reclaims that vertical real
 * estate for its toolbar.
 */
export default function ArtistPage() {
  const artistTab = useSystemStore((s) => s.artistTab);

  if (artistTab === 'media-studio') {
    return (
      <ContentBox>
        <ContentBody flex noPadding>
          <div key={artistTab} className="animate-fade-slide-in flex-1 flex flex-col min-h-0">
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
      <ContentBody centered>
        <div key={artistTab} className="animate-fade-slide-in">
          <Suspense fallback={null}>
            {artistTab === 'blender' && <CreativeStudioPanel />}
            {artistTab === 'gallery' && <GalleryPage />}
          </Suspense>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
