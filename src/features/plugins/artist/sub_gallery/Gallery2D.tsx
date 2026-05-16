import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  X,
} from 'lucide-react';
import type { ArtistAsset } from '@/api/artist';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { silentCatch } from '@/lib/silentCatch';
import { useGallerySelection } from '../hooks/useGallerySelection';
import { useLocalImage } from '../hooks/useLocalImage';
import { mergeTagAcross } from './tagOps';
import AssetCard from './AssetCard';
import GallerySelectionBar from './GallerySelectionBar';

interface Gallery2DProps {
  assets: ArtistAsset[];
  onDelete: (id: string) => void;
  onUpdateTags: (id: string, tags: string) => void;
}

export default function Gallery2D({ assets, onDelete, onUpdateTags }: Gallery2DProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { selectedIds, isSelected, toggle, clear, count } = useGallerySelection(assets);
  const inSelectMode = count > 0;

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

  const currentAsset = lightboxIndex !== null ? assets[lightboxIndex] : null;

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

      {/* Masonry-like grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {assets.map((asset, i) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            onDelete={onDelete}
            onUpdateTags={onUpdateTags}
            onClick={() => openLightbox(i)}
            selected={isSelected(asset.id)}
            inSelectMode={inSelectMode}
            onToggleSelect={handleToggle(asset.id, i)}
          />
        ))}
      </div>

      {currentAsset && lightboxIndex !== null && !inSelectMode && (
        <LightboxOverlay
          asset={currentAsset}
          index={lightboxIndex}
          total={assets.length}
          onClose={closeLightbox}
          onNext={goNext}
          onPrev={goPrev}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// LightboxOverlay — owns zoom / pan / fullscreen / clipboard interactions for
// the open image. Zoom is bounded [1, 5]; pan is only active when zoom > 1
// and is reset whenever the asset changes or zoom returns to 1.
// ---------------------------------------------------------------------------

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.25;

interface LightboxOverlayProps {
  asset: ArtistAsset;
  index: number;
  total: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}

function LightboxOverlay({ asset, index, total, onClose, onNext, onPrev }: LightboxOverlayProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Reset zoom + pan whenever the displayed asset changes.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [asset.id]);

  const clampZoom = useCallback((next: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)), []);

  const applyZoom = useCallback(
    (next: number) => {
      const clamped = clampZoom(next);
      setZoom(clamped);
      if (clamped <= 1) setPan({ x: 0, y: 0 });
    },
    [clampZoom],
  );

  const zoomIn = useCallback(() => applyZoom(zoom * ZOOM_STEP), [zoom, applyZoom]);
  const zoomOut = useCallback(() => applyZoom(zoom / ZOOM_STEP), [zoom, applyZoom]);
  const resetZoom = useCallback(() => applyZoom(1), [applyZoom]);

  // Sync local state to the browser's fullscreen API — the user can also exit
  // fullscreen via Esc (browser-native) without going through our button.
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    if (document.fullscreenElement === node) {
      document.exitFullscreen().catch(silentCatch('Exit lightbox fullscreen'));
    } else {
      node.requestFullscreen().catch(silentCatch('Enter lightbox fullscreen'));
    }
  }, []);

  const copyPath = useCallback(() => {
    navigator.clipboard
      .writeText(asset.filePath)
      .then(() => useToastStore.getState().addToast(t.plugins.artist.lightbox_path_copied, 'success'))
      .catch(silentCatch('Copy asset path'));
  }, [asset.filePath, t]);

  // Keyboard navigation while lightbox is open: ←/→ navigate, Esc closes,
  // + / − zoom, 0 resets, F toggles fullscreen, C copies path.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        onNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'Escape') {
        // Browser native handles exit-fullscreen on its own — only close the
        // overlay when no fullscreen is active so users don't lose the
        // lightbox just because they pressed Esc to leave fullscreen.
        if (!document.fullscreenElement) {
          e.preventDefault();
          onClose();
        }
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        resetZoom();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'c' || e.key === 'C') {
        // Don't intercept platform copy shortcuts on selection; bare C is fine.
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        copyPath();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onNext, onPrev, onClose, zoomIn, zoomOut, resetZoom, toggleFullscreen, copyPath]);

  const handleWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      // Wheel up zooms in; wheel down zooms out. Step is small enough that a
      // single notch on a typical mouse moves about one zoom tick.
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      applyZoom(zoom * factor);
    },
    [zoom, applyZoom],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLImageElement>) => {
      if (zoom <= 1) return;
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      setIsDragging(true);
    },
    [zoom, pan.x, pan.y],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLImageElement>) => {
      if (!dragStart.current) return;
      e.stopPropagation();
      setPan({
        x: dragStart.current.panX + (e.clientX - dragStart.current.x),
        y: dragStart.current.panY + (e.clientY - dragStart.current.y),
      });
    },
    [],
  );

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLImageElement>) => {
    if (!dragStart.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragStart.current = null;
    setIsDragging(false);
  }, []);

  const cursorClass = zoom > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default';

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center overflow-hidden"
      onClick={onClose}
      onWheel={handleWheel}
    >
      {/* Top control rail */}
      <div className="absolute top-4 right-4 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={zoomOut}
          disabled={zoom <= MIN_ZOOM}
          title={t.plugins.artist.lightbox_zoom_out}
          aria-label={t.plugins.artist.lightbox_zoom_out}
          className="p-2 rounded-card bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-30 disabled:hover:bg-white/10"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={resetZoom}
          title={t.plugins.artist.lightbox_reset_zoom}
          aria-label={t.plugins.artist.lightbox_reset_zoom}
          className="px-2 py-1 rounded-card bg-white/10 text-white hover:bg-white/20 transition-colors text-md tabular-nums min-w-[3rem]"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={zoomIn}
          disabled={zoom >= MAX_ZOOM}
          title={t.plugins.artist.lightbox_zoom_in}
          aria-label={t.plugins.artist.lightbox_zoom_in}
          className="p-2 rounded-card bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-30 disabled:hover:bg-white/10"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={copyPath}
          title={t.plugins.artist.lightbox_copy_path}
          aria-label={t.plugins.artist.lightbox_copy_path}
          className="p-2 rounded-card bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? t.plugins.artist.lightbox_exit_fullscreen : t.plugins.artist.lightbox_fullscreen}
          aria-label={isFullscreen ? t.plugins.artist.lightbox_exit_fullscreen : t.plugins.artist.lightbox_fullscreen}
          className="p-2 rounded-card bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          title={t.common.close}
          aria-label={t.common.close}
          className="p-2 rounded-card bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Prev / Next */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onPrev(); }}
        aria-label={t.plugins.artist.lightbox_prev_image}
        className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-card bg-white/10 text-white hover:bg-white/20 transition-colors"
      >
        <ChevronLeft className="w-6 h-6" />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onNext(); }}
        aria-label={t.plugins.artist.lightbox_next_image}
        className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-card bg-white/10 text-white hover:bg-white/20 transition-colors"
      >
        <ChevronRight className="w-6 h-6" />
      </button>

      {/* Image — base64-loaded via Tauri IPC, zoom + pan applied via transform */}
      <LightboxImage
        filePath={asset.filePath}
        alt={asset.fileName}
        zoom={zoom}
        panX={pan.x}
        panY={pan.y}
        isDragging={isDragging}
        cursorClass={cursorClass}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      {/* Caption */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 rounded-card px-4 py-2 text-white text-md">
        {asset.fileName}
        <span className="ml-3 text-white/70 text-md">
          {index + 1} / {total}
        </span>
      </div>
    </div>
  );
}

interface LightboxImageProps {
  filePath: string;
  alt: string;
  zoom: number;
  panX: number;
  panY: number;
  isDragging: boolean;
  cursorClass: string;
  onPointerDown: (e: ReactPointerEvent<HTMLImageElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLImageElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLImageElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLImageElement>) => void;
}

/** Lightbox image loaded via base64 data URL from Tauri. */
function LightboxImage({
  filePath,
  alt,
  zoom,
  panX,
  panY,
  isDragging,
  cursorClass,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: LightboxImageProps) {
  const dataUrl = useLocalImage(filePath);

  if (!dataUrl) {
    return <Loader2 className="w-8 h-8 text-white animate-spin" />;
  }

  return (
    <img
      src={dataUrl}
      alt={alt}
      decoding="async"
      draggable={false}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{
        transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
        transition: isDragging ? 'none' : 'transform 120ms ease-out',
        transformOrigin: 'center center',
      }}
      className={`max-w-[90vw] max-h-[85vh] object-contain rounded-card shadow-elevation-4 select-none ${cursorClass}`}
    />
  );
}
