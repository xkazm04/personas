import { useState, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { ArtistAsset } from '@/api/artist';
import { useLocalImage } from '../hooks/useLocalImage';
import AssetCard from './AssetCard';

interface Gallery2DProps {
  assets: ArtistAsset[];
  onDelete: (id: string) => void;
  onUpdateTags: (id: string, tags: string) => void;
}

export default function Gallery2D({ assets, onDelete, onUpdateTags }: Gallery2DProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  const goNext = useCallback(() => {
    setLightboxIndex((i) => (i !== null ? (i + 1) % assets.length : null));
  }, [assets.length]);

  const goPrev = useCallback(() => {
    setLightboxIndex((i) => (i !== null ? (i - 1 + assets.length) % assets.length : null));
  }, [assets.length]);

  const currentAsset = lightboxIndex !== null ? assets[lightboxIndex] : null;

  return (
    <>
      {/* Masonry-like grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {assets.map((asset, i) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            onDelete={onDelete}
            onUpdateTags={onUpdateTags}
            onClick={() => openLightbox(i)}
          />
        ))}
      </div>

      {/* Lightbox */}
      {currentAsset && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
          onClick={closeLightbox}
        >
          {/* Controls */}
          <button
            onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
            className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          {/* Image — loaded via Tauri IPC base64 */}
          <LightboxImage filePath={currentAsset.filePath} alt={currentAsset.fileName} />

          {/* Caption */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 rounded-lg px-4 py-2 text-white text-sm">
            {currentAsset.fileName}
            <span className="ml-3 text-white/70 text-xs">
              {lightboxIndex! + 1} / {assets.length}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

/** Lightbox image that loads via base64 data URL from Tauri. */
function LightboxImage({ filePath, alt }: { filePath: string; alt: string }) {
  const dataUrl = useLocalImage(filePath);

  if (!dataUrl) {
    return <Loader2 className="w-8 h-8 text-white animate-spin" />;
  }

  return (
    <img
      src={dataUrl}
      alt={alt}
      className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    />
  );
}
