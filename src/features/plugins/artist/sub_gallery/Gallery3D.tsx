import { lazy, Suspense, useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { ChevronLeft, ChevronRight, X, RotateCw, Grid3x3, Box, Loader2 } from 'lucide-react';
import type { ArtistAsset } from '@/api/artist';
import { useGallerySelection } from '../hooks/useGallerySelection';
import { useModelViewer } from '../hooks/useModelViewer';
import { formatFileSize } from '../utils/format';
import AssetCard from './AssetCard';
import GallerySelectionBar from './GallerySelectionBar';
import { mergeTagAcross } from './tagOps';

// Lazy-load three.js — the ~500KB gzipped bundle only matters when a user
// actually opens a .glb/.gltf model for the first time.
const ThreeViewer = lazy(() => import('./ThreeViewer'));

interface Gallery3DProps {
  assets: ArtistAsset[];
  onDelete: (id: string) => void;
  onUpdateTags: (id: string, tags: string) => void;
  onRename?: (id: string, newBasename: string) => void;
}

export default function Gallery3D({ assets, onDelete, onUpdateTags, onRename }: Gallery3DProps) {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const { selectedIds, isSelected, toggle, clear, count } = useGallerySelection(assets);
  const inSelectMode = count > 0;
  const {
    wireframe, autoRotate, lightingPreset,
    toggleWireframe, toggleAutoRotate, setLightingPreset,
  } = useModelViewer();

  const handleToggle = useCallback(
    (id: string, index: number) => (e: ReactMouseEvent) => toggle(id, index, e.shiftKey),
    [toggle],
  );

  const handleBulkDelete = useCallback(() => {
    const ids = [...selectedIds];
    clear();
    for (const id of ids) onDelete(id);
  }, [selectedIds, clear, onDelete]);

  const handleBulkAddTag = useCallback(
    (tag: string) => {
      const ids = [...selectedIds];
      clear();
      for (const id of ids) {
        const asset = assets.find((a) => a.id === id);
        if (!asset) continue;
        const merged = mergeTagAcross(asset.tags ?? '', tag);
        if (merged !== (asset.tags ?? '')) onUpdateTags(id, merged);
      }
    },
    [selectedIds, clear, assets, onUpdateTags],
  );

  const selectedAsset = !inSelectMode && selectedIndex !== null ? assets[selectedIndex] : null;
  const isViewable = selectedAsset && ['glb', 'gltf'].includes(
    selectedAsset.fileName.split('.').pop()?.toLowerCase() ?? '',
  );

  const goNext = useCallback(() => {
    setSelectedIndex((i) => (i !== null && assets.length > 0 ? (i + 1) % assets.length : i));
  }, [assets.length]);

  const goPrev = useCallback(() => {
    setSelectedIndex((i) =>
      i !== null && assets.length > 0 ? (i - 1 + assets.length) % assets.length : i,
    );
  }, [assets.length]);

  // Keyboard navigation while the 3D viewer is open — mirrors the 2D
  // lightbox shape (← / → cycle, Esc closes) so reviewing batch Blender
  // output does not require close-and-reopen for each model.
  useEffect(() => {
    if (!selectedAsset) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedIndex(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedAsset, goNext, goPrev]);

  return (
    <>
      {inSelectMode && (
        <GallerySelectionBar
          count={count}
          onDelete={handleBulkDelete}
          onAddTag={handleBulkAddTag}
          onClear={clear}
        />
      )}

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {assets.map((asset, i) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            onDelete={onDelete}
            onUpdateTags={onUpdateTags}
            onRename={onRename}
            onClick={() => setSelectedIndex(i)}
            selected={isSelected(asset.id)}
            inSelectMode={inSelectMode}
            onToggleSelect={handleToggle(asset.id, i)}
          />
        ))}
      </div>

      {/* 3D Viewer Modal */}
      {selectedAsset && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center"
          onClick={() => setSelectedIndex(null)}
        >
          {assets.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); goPrev(); }}
                aria-label={t.plugins.artist.viewer_prev_model}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-card bg-secondary/10 text-foreground hover:bg-secondary/20 transition-colors z-10"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); goNext(); }}
                aria-label={t.plugins.artist.viewer_next_model}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-card bg-secondary/10 text-foreground hover:bg-secondary/20 transition-colors z-10"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}
          <div
            className="relative w-[85vw] max-w-5xl h-[80vh] rounded-2xl border border-primary/10 bg-card overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10">
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-rose-400" />
                <span className="typo-section-title">{selectedAsset.fileName}</span>
                <span className="text-md text-foreground font-mono">
                  {selectedAsset.fileName.split('.').pop()?.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {/* Viewer controls */}
                <button
                  onClick={toggleAutoRotate}
                  className={`p-1.5 rounded-card text-md transition-colors ${
                    autoRotate ? 'bg-rose-500/15 text-rose-400' : 'text-foreground hover:bg-secondary/40'
                  }`}
                  title={t.plugins.artist.auto_rotate}
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={toggleWireframe}
                  className={`p-1.5 rounded-card text-md transition-colors ${
                    wireframe ? 'bg-rose-500/15 text-rose-400' : 'text-foreground hover:bg-secondary/40'
                  }`}
                  title={t.plugins.artist.wireframe}
                >
                  <Grid3x3 className="w-3.5 h-3.5" />
                </button>
                <select
                  value={lightingPreset}
                  onChange={(e) => setLightingPreset(e.target.value as 'studio' | 'outdoor' | 'soft')}
                  className="px-2 py-1 rounded-card bg-background/80 border border-primary/10 text-md text-foreground"
                >
                  <option value="studio">{ t.plugins.artist.lighting_studio}</option>
                  <option value="outdoor">{ t.plugins.artist.lighting_outdoor}</option>
                  <option value="soft">{ t.plugins.artist.lighting_soft}</option>
                </select>
                <button
                  onClick={() => setSelectedIndex(null)}
                  className="p-1.5 rounded-card text-foreground hover:bg-secondary/40 ml-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Viewer area */}
            <div className="flex-1 flex items-center justify-center bg-gradient-to-b from-zinc-900 to-zinc-950 relative">
              {isViewable ? (
                <Suspense
                  fallback={
                    <div className="flex flex-col items-center gap-2 text-foreground">
                      <Loader2 className="w-6 h-6 animate-spin text-rose-400" />
                      <span className="text-md">{t.plugins.artist_gallery.loading_viewer}</span>
                    </div>
                  }
                >
                  <ThreeViewer
                    filePath={selectedAsset.filePath}
                    wireframe={wireframe}
                    autoRotate={autoRotate}
                    lightingPreset={lightingPreset}
                  />
                </Suspense>
              ) : (
                <div className="text-center space-y-3">
                  <Box className="w-16 h-16 text-rose-400 mx-auto" />
                  <p className="typo-section-title">
                    {t.plugins.artist.preview_not_available}
                  </p>
                  <p className="typo-body text-foreground max-w-sm">
                    {t.plugins.artist.preview_glb_hint}
                  </p>
                </div>
              )}
            </div>

            {/* Footer metadata */}
            <div className="px-4 py-2 border-t border-primary/10 flex items-center gap-4 text-md text-foreground">
              <span>{formatFileSize(Number(selectedAsset.fileSize))}</span>
              <span>{selectedAsset.createdAt}</span>
              {selectedAsset.tags && <span>{t.plugins.artist.tags_label} {selectedAsset.tags}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

