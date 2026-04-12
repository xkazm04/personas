import { useState, useCallback, useRef, type WheelEvent } from 'react';
import { ZoomIn, ZoomOut, Maximize2, GripHorizontal } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { PIXELS_PER_SECOND_DEFAULT, MIN_ZOOM, MAX_ZOOM } from './constants';
import type { VideoClip, AudioClip, TextItem, ImageItem } from './types';
import TimelineRuler from './TimelineRuler';
import TimelinePlayhead from './TimelinePlayhead';
import TextLane from './TextLane';
import ImageLane from './ImageLane';
import VideoLane from './VideoLane';
import AudioLane from './AudioLane';

interface TimelinePanelProps {
  textItems: TextItem[];
  imageItems: ImageItem[];
  videoItems: VideoClip[];
  audioItems: AudioClip[];
  totalDuration: number;
  currentTime: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  onAddText: () => void;
  onAddImage: () => void;
  onAddVideo: () => void;
  onAddAudio: () => void;
}

function CollapsedLaneHeader({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-0.5 bg-${color}-500/5 border-b border-${color}-500/15 hover:bg-${color}-500/10 transition-colors cursor-pointer`}
    >
      <span className={`text-[9px] font-bold text-${color}-400 uppercase`}>{label}</span>
      <GripHorizontal className={`w-3 h-3 text-${color}-400/40`} />
    </button>
  );
}

export default function TimelinePanel({
  textItems,
  imageItems,
  videoItems,
  audioItems,
  totalDuration,
  currentTime,
  selectedId,
  onSelect,
  onSeek,
  onUpdate,
  onAddText,
  onAddImage,
  onAddVideo,
  onAddAudio,
}: TimelinePanelProps) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(PIXELS_PER_SECOND_DEFAULT);
  const [scrollX, setScrollX] = useState(0);
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleLane = useCallback((lane: string) => {
    setCollapsedLanes((prev) => {
      const next = new Set(prev);
      if (next.has(lane)) next.delete(lane);
      else next.add(lane);
      return next;
    });
  }, []);

  // Ctrl+Scroll to zoom, plain scroll for horizontal pan
  const handleWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom((prev) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev - e.deltaY * 0.5)));
      } else {
        setScrollX((prev) => Math.max(0, prev + e.deltaX + e.deltaY));
      }
    },
    [],
  );

  const zoomIn = useCallback(() => {
    setZoom((prev) => Math.min(MAX_ZOOM, prev + 10));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((prev) => Math.max(MIN_ZOOM, prev - 10));
  }, []);

  const fitToView = useCallback(() => {
    if (containerRef.current && totalDuration > 0) {
      const containerWidth = containerRef.current.clientWidth;
      setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, containerWidth / totalDuration * 0.9)));
      setScrollX(0);
    }
  }, [totalDuration]);

  return (
    <div className="flex flex-col border-t-2 border-primary/15 bg-gradient-to-b from-card/60 to-card/30">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-1 border-b border-primary/10 bg-card/70">
        <Button variant="ghost" size="icon-sm" onClick={zoomOut} title={t.media_studio.zoom_out}>
          <ZoomOut className="w-3.5 h-3.5" />
        </Button>

        {/* Zoom slider */}
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-20 h-1 accent-rose-400"
        />

        <Button variant="ghost" size="icon-sm" onClick={zoomIn} title={t.media_studio.zoom_in}>
          <ZoomIn className="w-3.5 h-3.5" />
        </Button>

        <span className="text-[10px] text-muted-foreground/50 w-12 text-center tabular-nums font-mono">
          {Math.round(zoom)}px/s
        </span>

        <div className="w-px h-4 bg-primary/10 mx-1" />

        <Button variant="ghost" size="icon-sm" onClick={fitToView} title={t.media_studio.fit_to_view}>
          <Maximize2 className="w-3.5 h-3.5" />
        </Button>

        <div className="w-px h-4 bg-primary/10 mx-1" />

        {/* Lane toggle pills */}
        <div className="flex items-center gap-0.5">
          {(['text', 'image', 'video', 'audio'] as const).map((lane) => {
            const colors: Record<string, string> = { text: 'amber', image: 'emerald', video: 'rose', audio: 'blue' };
            const labels: Record<string, string> = { text: 'T', image: 'I', video: 'V', audio: 'A' };
            const c = colors[lane]!;
            const collapsed = collapsedLanes.has(lane);
            return (
              <button
                key={lane}
                onClick={() => toggleLane(lane)}
                className={`w-5 h-5 rounded text-[9px] font-bold transition-all ${
                  collapsed
                    ? `bg-${c}-500/5 text-${c}-400/30 border border-${c}-500/10`
                    : `bg-${c}-500/20 text-${c}-400 border border-${c}-500/30`
                }`}
              >
                {labels[lane]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Timeline body */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
        onWheel={handleWheel}
      >
        {/* Ruler + Playhead share the same coordinate space */}
        <TimelineRuler zoom={zoom} duration={totalDuration} scrollX={scrollX} />
        <TimelinePlayhead
          currentTime={currentTime}
          zoom={zoom}
          scrollX={scrollX}
          onSeek={onSeek}
        />

        {/* Lanes — top to bottom: text, image, video, audio */}
        {!collapsedLanes.has('text') && (
          <TextLane
            items={textItems}
            zoom={zoom}
            scrollX={scrollX}
            selectedId={selectedId}
            onSelect={onSelect}
            onAdd={onAddText}
            onUpdate={onUpdate}
          />
        )}
        {collapsedLanes.has('text') && (
          <CollapsedLaneHeader label="T" color="amber" onClick={() => toggleLane('text')} />
        )}

        {!collapsedLanes.has('image') && (
          <ImageLane
            items={imageItems}
            zoom={zoom}
            scrollX={scrollX}
            selectedId={selectedId}
            onSelect={onSelect}
            onAdd={onAddImage}
          />
        )}
        {collapsedLanes.has('image') && (
          <CollapsedLaneHeader label="I" color="emerald" onClick={() => toggleLane('image')} />
        )}

        {!collapsedLanes.has('video') && (
          <VideoLane
            items={videoItems}
            zoom={zoom}
            scrollX={scrollX}
            selectedId={selectedId}
            onSelect={onSelect}
            onAdd={onAddVideo}
            onUpdate={onUpdate}
          />
        )}
        {collapsedLanes.has('video') && (
          <CollapsedLaneHeader label="V" color="rose" onClick={() => toggleLane('video')} />
        )}

        {!collapsedLanes.has('audio') && (
          <AudioLane
            items={audioItems}
            zoom={zoom}
            scrollX={scrollX}
            selectedId={selectedId}
            onSelect={onSelect}
            onAdd={onAddAudio}
            onUpdate={onUpdate}
          />
        )}
        {collapsedLanes.has('audio') && (
          <CollapsedLaneHeader label="A" color="blue" onClick={() => toggleLane('audio')} />
        )}
      </div>
    </div>
  );
}
