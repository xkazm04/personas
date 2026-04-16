import {
  memo,
  useState,
  useCallback,
  useRef,
  useEffect,
  type WheelEvent,
  type PointerEvent,
  type MouseEvent,
} from 'react';
import {
  ZoomIn, ZoomOut, Maximize2, Plus, Type, ImageIcon, Film, Music, Undo2, Redo2,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { PIXELS_PER_SECOND_DEFAULT, MIN_ZOOM, MAX_ZOOM } from './constants';
import type { VideoClip, AudioClip, TextItem, ImageItem } from './types';
import type { PlaybackEngine } from './hooks/useTimelinePlayback';
import TimelineRuler from './TimelineRuler';
import TextLane from './TextLane';
import ImageLane from './ImageLane';
import VideoLane from './VideoLane';
import AudioLane from './AudioLane';

interface TimelinePanelProps {
  engine: PlaybackEngine;
  textItems: TextItem[];
  imageItems: ImageItem[];
  videoItems: VideoClip[];
  audioItems: AudioClip[];
  totalDuration: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  onAddText: () => void;
  onAddImage: () => void;
  onAddVideo: () => void;
  onAddAudio: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

const RULER_HEIGHT = 28;
const LANE_HEIGHTS = { text: 41, image: 49, video: 57, audio: 57 } as const;

type LaneKey = 'text' | 'image' | 'video' | 'audio';

// Tailwind 4 JIT scans source for literal class names — dynamic template
// strings like `bg-${color}-500/5` never get compiled. Every color shade used
// for a lane must therefore appear as a literal string somewhere Tailwind can
// see. This map centralizes those literals per lane.
interface LaneClasses {
  collapsedRail: string;
  collapsedIcon: string;
  collapsedLabel: string;
  rail: string;
  railLabel: string;
  countBadge: string;
  addButton: string;
  collapsedStripe: string;
}

const LANE_META: Record<LaneKey, { icon: typeof Type; label: string; classes: LaneClasses }> = {
  text: {
    icon: Type,
    label: 'Text',
    classes: {
      collapsedRail: 'bg-amber-500/5 hover:bg-amber-500/10',
      collapsedIcon: 'text-amber-400/40',
      collapsedLabel: 'text-amber-400/50',
      rail: 'bg-amber-500/5',
      railLabel: 'text-amber-400',
      countBadge: 'bg-amber-500/15 text-amber-400/80',
      addButton: 'border-amber-500/25 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400',
      collapsedStripe: 'bg-amber-500/5',
    },
  },
  image: {
    icon: ImageIcon,
    label: 'Image',
    classes: {
      collapsedRail: 'bg-emerald-500/5 hover:bg-emerald-500/10',
      collapsedIcon: 'text-emerald-400/40',
      collapsedLabel: 'text-emerald-400/50',
      rail: 'bg-emerald-500/5',
      railLabel: 'text-emerald-400',
      countBadge: 'bg-emerald-500/15 text-emerald-400/80',
      addButton: 'border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400',
      collapsedStripe: 'bg-emerald-500/5',
    },
  },
  video: {
    icon: Film,
    label: 'Video',
    classes: {
      collapsedRail: 'bg-rose-500/5 hover:bg-rose-500/10',
      collapsedIcon: 'text-rose-400/40',
      collapsedLabel: 'text-rose-400/50',
      rail: 'bg-rose-500/5',
      railLabel: 'text-rose-400',
      countBadge: 'bg-rose-500/15 text-rose-400/80',
      addButton: 'border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400',
      collapsedStripe: 'bg-rose-500/5',
    },
  },
  audio: {
    icon: Music,
    label: 'Audio',
    classes: {
      collapsedRail: 'bg-blue-500/5 hover:bg-blue-500/10',
      collapsedIcon: 'text-blue-400/40',
      collapsedLabel: 'text-blue-400/50',
      rail: 'bg-blue-500/5',
      railLabel: 'text-blue-400',
      countBadge: 'bg-blue-500/15 text-blue-400/80',
      addButton: 'border-blue-500/25 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400',
      collapsedStripe: 'bg-blue-500/5',
    },
  },
};

function TimelinePanelImpl({
  engine,
  textItems,
  imageItems,
  videoItems,
  audioItems,
  totalDuration,
  selectedId,
  onSelect,
  onSeek,
  onUpdate,
  onAddText,
  onAddImage,
  onAddVideo,
  onAddAudio,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: TimelinePanelProps) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(PIXELS_PER_SECOND_DEFAULT);
  const [collapsedLanes, setCollapsedLanes] = useState<Set<LaneKey>>(new Set());
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const visibleDuration = Math.max(totalDuration, 10);
  const contentWidth = visibleDuration * zoom;

  // -- Imperative playhead sync -----------------------------------------------
  //
  // The playhead position is driven by the engine directly — no React state
  // on the hot path. Subscribing here keeps the whole TimelinePanel tree from
  // rendering 60 times a second.
  useEffect(() => {
    const apply = (time: number) => {
      const x = time * zoomRef.current;
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${x}px)`;
      }
      if (handleRef.current) {
        handleRef.current.style.transform = `translateX(${x - 7}px)`;
      }
      // Auto-scroll to keep the playhead in view when playing
      const scroller = scrollRef.current;
      if (scroller && engine.getPlaying()) {
        const { scrollLeft, clientWidth } = scroller;
        const margin = 80;
        if (x < scrollLeft + margin) {
          scroller.scrollLeft = Math.max(0, x - margin);
        } else if (x > scrollLeft + clientWidth - margin) {
          scroller.scrollLeft = x - clientWidth + margin;
        }
      }
    };
    return engine.subscribe(apply);
  }, [engine]);

  // Re-apply playhead when zoom changes (without another subscription)
  useEffect(() => {
    const x = engine.getTime() * zoom;
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translateX(${x}px)`;
    }
    if (handleRef.current) {
      handleRef.current.style.transform = `translateX(${x - 7}px)`;
    }
  }, [zoom, engine]);

  const toggleLane = useCallback((lane: LaneKey) => {
    setCollapsedLanes((prev) => {
      const next = new Set(prev);
      if (next.has(lane)) next.delete(lane);
      else next.add(lane);
      return next;
    });
  }, []);

  // Ctrl+wheel to zoom; plain wheel falls through to native horizontal scroll.
  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom((prev) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev - e.deltaY * 0.5)));
    }
  }, []);

  const zoomIn = useCallback(() => {
    setZoom((prev) => Math.min(MAX_ZOOM, prev + 10));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((prev) => Math.max(MIN_ZOOM, prev - 10));
  }, []);

  const fitToView = useCallback(() => {
    if (scrollRef.current && totalDuration > 0) {
      const containerWidth = scrollRef.current.clientWidth;
      setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (containerWidth / totalDuration) * 0.9)));
      scrollRef.current.scrollLeft = 0;
    }
  }, [totalDuration]);

  // -- Seek handling -----------------------------------------------------------

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const content = contentRef.current;
      if (!content) return;
      const rect = content.getBoundingClientRect();
      const x = clientX - rect.left;
      onSeek(Math.max(0, x / zoomRef.current));
    },
    [onSeek],
  );

  const handleRulerClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (dragging) return;
      seekFromClientX(e.clientX);
    },
    [dragging, seekFromClientX],
  );

  const handleHandlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [],
  );

  const handleHandlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      seekFromClientX(e.clientX);
    },
    [dragging, seekFromClientX],
  );

  const handleHandlePointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDragging(false);
  }, []);

  // -- Lane rail ---------------------------------------------------------------

  const renderRail = (lane: LaneKey, onAdd: () => void, count: number) => {
    const meta = LANE_META[lane];
    const Icon = meta.icon;
    const c = meta.classes;
    const collapsed = collapsedLanes.has(lane);
    if (collapsed) {
      return (
        <button
          key={lane}
          onClick={() => toggleLane(lane)}
          className={`h-5 flex items-center gap-2 px-3 border-b border-primary/10 transition-colors ${c.collapsedRail}`}
        >
          <Icon className={`w-3 h-3 ${c.collapsedIcon}`} />
          <span className={`text-[9px] font-semibold uppercase tracking-wider ${c.collapsedLabel}`}>
            {meta.label}
          </span>
        </button>
      );
    }
    return (
      <div
        key={lane}
        className={`flex items-center gap-2 px-2.5 border-b border-primary/10 ${c.rail}`}
        style={{ height: `${LANE_HEIGHTS[lane]}px` }}
      >
        <button
          onClick={() => toggleLane(lane)}
          className="flex items-center gap-1.5 flex-1 text-left hover:opacity-80 transition-opacity"
        >
          <Icon className={`w-3.5 h-3.5 ${c.railLabel}`} />
          <span className={`typo-heading text-[10px] uppercase tracking-wider ${c.railLabel}`}>
            {meta.label}
          </span>
          {count > 0 && (
            <span className={`text-[9px] rounded-full px-1.5 py-px tabular-nums ${c.countBadge}`}>
              {count}
            </span>
          )}
        </button>
        <button
          onClick={onAdd}
          className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${c.addButton}`}
          aria-label={`add-${lane}`}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full border-t-2 border-primary/20 bg-card/30">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-1 border-b border-primary/10 bg-card/70 flex-shrink-0">
        <Button variant="ghost" size="icon-sm" onClick={zoomOut} title={t.media_studio.zoom_out}>
          <ZoomOut className="w-3.5 h-3.5" />
        </Button>

        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-24 h-1 accent-rose-400"
        />

        <Button variant="ghost" size="icon-sm" onClick={zoomIn} title={t.media_studio.zoom_in}>
          <ZoomIn className="w-3.5 h-3.5" />
        </Button>

        <span className="text-[10px] text-muted-foreground/50 w-14 text-center tabular-nums font-mono">
          {Math.round(zoom)}px/s
        </span>

        <div className="w-px h-4 bg-primary/10 mx-1" />

        <Button variant="ghost" size="icon-sm" onClick={fitToView} title={t.media_studio.fit_to_view}>
          <Maximize2 className="w-3.5 h-3.5" />
        </Button>

        {onUndo && (
          <>
            <div className="w-px h-4 bg-primary/10 mx-1" />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onUndo}
              disabled={!canUndo}
              title={`${t.media_studio.undo} (Ctrl+Z)`}
            >
              <Undo2 className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRedo}
              disabled={!canRedo}
              title={`${t.media_studio.redo} (Ctrl+Shift+Z)`}
            >
              <Redo2 className="w-3.5 h-3.5" />
            </Button>
          </>
        )}

        <div className="flex-1" />

        <span className="text-[10px] text-muted-foreground/40 font-mono tabular-nums">
          {Math.round(totalDuration * 10) / 10}s
        </span>
      </div>

      {/* Body: left rail + scrollable lanes */}
      <div className="flex flex-1 min-h-0">
        {/* Left rail — fixed width */}
        <div className="w-[132px] flex-shrink-0 border-r border-primary/15 bg-card/60 flex flex-col overflow-hidden">
          <div
            className="border-b border-primary/15 flex items-center justify-end pr-2 flex-shrink-0"
            style={{ height: `${RULER_HEIGHT}px` }}
          >
            <span className="text-[9px] text-muted-foreground/40 uppercase tracking-widest font-mono">
              timeline
            </span>
          </div>
          {renderRail('text', onAddText, textItems.length)}
          {renderRail('image', onAddImage, imageItems.length)}
          {renderRail('video', onAddVideo, videoItems.length)}
          {renderRail('audio', onAddAudio, audioItems.length)}
        </div>

        {/* Scrollable lane area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto overflow-y-hidden relative"
          onWheel={handleWheel}
        >
          <div
            ref={contentRef}
            className="relative min-h-full"
            style={{ width: `${Math.max(contentWidth, 400)}px` }}
          >
            {/* Ruler — clickable for seek */}
            <div
              className="relative border-b border-primary/15 cursor-pointer hover:bg-secondary/10 transition-colors"
              style={{ height: `${RULER_HEIGHT}px` }}
              onClick={handleRulerClick}
            >
              <TimelineRuler zoom={zoom} duration={totalDuration} />
            </div>

            {/* Lanes */}
            {!collapsedLanes.has('text') && (
              <TextLane
                items={textItems}
                zoom={zoom}
                scrollX={0}
                selectedId={selectedId}
                onSelect={onSelect}
                onAdd={onAddText}
                onUpdate={onUpdate}
                hideHeader
                hideAdd
              />
            )}
            {collapsedLanes.has('text') && (
              <div className="h-5 border-b border-primary/10 bg-amber-500/5" />
            )}

            {!collapsedLanes.has('image') && (
              <ImageLane
                items={imageItems}
                zoom={zoom}
                scrollX={0}
                selectedId={selectedId}
                onSelect={onSelect}
                onAdd={onAddImage}
                onUpdate={onUpdate}
                hideHeader
                hideAdd
              />
            )}
            {collapsedLanes.has('image') && (
              <div className="h-5 border-b border-primary/10 bg-emerald-500/5" />
            )}

            {!collapsedLanes.has('video') && (
              <VideoLane
                items={videoItems}
                zoom={zoom}
                scrollX={0}
                selectedId={selectedId}
                onSelect={onSelect}
                onAdd={onAddVideo}
                onUpdate={onUpdate}
                hideHeader
                hideAdd
              />
            )}
            {collapsedLanes.has('video') && (
              <div className="h-5 border-b border-primary/10 bg-rose-500/5" />
            )}

            {!collapsedLanes.has('audio') && (
              <AudioLane
                items={audioItems}
                zoom={zoom}
                scrollX={0}
                selectedId={selectedId}
                onSelect={onSelect}
                onAdd={onAddAudio}
                onUpdate={onUpdate}
                hideHeader
                hideAdd
              />
            )}
            {collapsedLanes.has('audio') && (
              <div className="h-5 border-b border-primary/10 bg-blue-500/5" />
            )}

            {/* Playhead line — imperatively positioned */}
            <div
              ref={playheadRef}
              className={`absolute top-0 bottom-0 left-0 w-px pointer-events-none z-30 will-change-transform ${
                dragging ? 'bg-red-400' : 'bg-red-500/90'
              }`}
              style={{ transform: 'translateX(0px)' }}
            >
              {dragging && (
                <div className="absolute top-0 bottom-0 -left-1 w-3 bg-red-500/10 pointer-events-none" />
              )}
            </div>

            {/* Playhead handle — only in ruler area, draggable */}
            <div
              ref={handleRef}
              className="absolute left-0 z-40 will-change-transform"
              style={{ top: 0, width: '14px', height: `${RULER_HEIGHT}px`, transform: 'translateX(-7px)' }}
            >
              <div
                className="w-full h-full cursor-grab active:cursor-grabbing flex items-start justify-center"
                onPointerDown={handleHandlePointerDown}
                onPointerMove={handleHandlePointerMove}
                onPointerUp={handleHandlePointerUp}
                onPointerCancel={handleHandlePointerUp}
              >
                <svg width="14" height="10" viewBox="0 0 14 10" className="pointer-events-none">
                  <path
                    d="M0 0 L14 0 L7 10 Z"
                    className={
                      dragging
                        ? 'fill-red-400 drop-shadow-[0_0_4px_rgba(239,68,68,0.5)]'
                        : 'fill-red-500'
                    }
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const TimelinePanel = memo(TimelinePanelImpl);
export default TimelinePanel;
