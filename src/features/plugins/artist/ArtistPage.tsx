import { lazy, Suspense } from 'react';
import { Palette, Box, Image } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import type { ArtistTab } from '@/lib/types/types';

const BlenderMcpPanel = lazy(() => import('./sub_blender/BlenderMcpPanel'));
const GalleryPage = lazy(() => import('./sub_gallery/GalleryPage'));

const tabs: { id: ArtistTab; label: string; icon: typeof Palette }[] = [
  { id: 'blender', label: 'Blender Studio', icon: Box },
  { id: 'gallery', label: 'Gallery', icon: Image },
];

export default function ArtistPage() {
  const artistTab = useSystemStore((s) => s.artistTab);
  const setArtistTab = useSystemStore((s) => s.setArtistTab);

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-4 pb-2">
        <Palette className="w-5 h-5 text-rose-400/70 mr-2" />
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setArtistTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg typo-heading transition-colors ${
                artistTab === t.id
                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                  : 'text-muted-foreground/60 hover:bg-secondary/40 hover:text-foreground/80 border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div key={artistTab} className="animate-fade-slide-in flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        <Suspense fallback={null}>
          {artistTab === 'blender' && <BlenderMcpPanel />}
          {artistTab === 'gallery' && <GalleryPage />}
        </Suspense>
      </div>
    </div>
  );
}
