import { memo, useCallback } from 'react';
import { Film, Plus, Blend, Moon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { formatDurationHuman } from '../utils/format';
import { useVideoThumbnails } from './hooks/useVideoThumbnails';
import type { VideoClip } from './types';
import TimelineClip from './TimelineClip';

interface VideoLaneProps {
  items: VideoClip[];
  zoom: number;
  scrollX: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onUpdate?: (id: string, patch: Partial<VideoClip>) => void;
  hideHeader?: boolean;
  hideAdd?: boolean;
}

function VideoLaneImpl({
  items,
  zoom,
  scrollX,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  hideHeader,
  hideAdd,
}: VideoLaneProps) {
  const { t } = useTranslation();

  const handleMove = useCallback(
    (id: string, newStartTime: number) => {
      onUpdate?.(id, { startTime: newStartTime });
    },
    [onUpdate],
  );

  const handleTrimLeft = useCallback(
    (id: string, clip: VideoClip, delta: number) => {
      const newTrimStart = Math.max(0, clip.trimStart + delta);
      const actualDelta = newTrimStart - clip.trimStart;
      onUpdate?.(id, {
        startTime: clip.startTime + actualDelta,
        duration: clip.duration - actualDelta,
        trimStart: newTrimStart,
      });
    },
    [onUpdate],
  );

  const handleTrimRight = useCallback(
    (id: string, clip: VideoClip, delta: number) => {
      const newDuration = Math.max(0.25, clip.duration + delta);
      const maxDuration = clip.mediaDuration - clip.trimStart - clip.trimEnd;
      onUpdate?.(id, { duration: Math.min(newDuration, maxDuration) });
    },
    [onUpdate],
  );

  return (
    <div className="flex flex-col">
      {/* Lane header */}
      {!hideHeader && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 border-b border-rose-500/20">
          <Film className="w-3.5 h-3.5 text-rose-400" />
          <span className="typo-label text-rose-400">
            {t.media_studio.layer_video}
          </span>
          {items.length > 0 && (
            <span className="ml-auto text-md text-rose-400/60 bg-rose-500/10 rounded-full px-1.5 py-0.5 tabular-nums">
              {items.length}
            </span>
          )}
        </div>
      )}

      {/* Clips area */}
      <div className="relative h-14 bg-rose-500/[0.02] border-b border-primary/10">
        {/* Empty lane hint */}
        {items.length === 0 && (
          <div className="absolute inset-1 rounded-card border border-dashed border-rose-500/15 flex items-center justify-center">
            <span className="text-md text-rose-400/30">{t.media_studio.empty_lane}</span>
          </div>
        )}
        {/* Transition indicators between clips */}
        {items.map((clip) => {
          if (clip.transition === 'cut' || clip.transitionDuration === 0) return null;
          const x = clip.startTime * zoom - scrollX;
          const Icon = clip.transition === 'crossfade' ? Blend : Moon;
          return (
            <div
              key={`tr-${clip.id}`}
              className="absolute top-0 flex items-center justify-center z-20 pointer-events-none"
              style={{ left: `${x - 8}px`, width: '16px', height: '100%' }}
            >
              <div className="w-5 h-5 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
                <Icon className="w-2.5 h-2.5 text-violet-400" />
              </div>
            </div>
          );
        })}
        {items.map((clip) => (
          <TimelineClip
            key={clip.id}
            id={clip.id}
            startTime={clip.startTime}
            duration={clip.duration}
            zoom={zoom}
            scrollX={scrollX}
            isSelected={clip.id === selectedId}
            className="top-1 h-12 rounded-card bg-rose-500/15 border border-rose-500/20 hover:bg-rose-500/25"
            selectedClassName="top-1 h-12 rounded-card bg-rose-500/30 border-2 border-rose-400 ring-1 ring-rose-400/40"
            onClick={() => onSelect(clip.id)}
            onMove={(newStart) => handleMove(clip.id, newStart)}
            onTrimLeft={(delta) => handleTrimLeft(clip.id, clip, delta)}
            onTrimRight={(delta) => handleTrimRight(clip.id, clip, delta)}
          >
            <VideoClipBody clip={clip} />

          </TimelineClip>
        ))}

        {/* Add button */}
        {!hideAdd && (
          <div
            className="absolute top-1 h-12 flex items-center"
            style={{
              left: `${items.length > 0
                ? Math.max(...items.map((c) => (c.startTime + c.duration) * zoom - scrollX)) + 8
                : 8
              }px`,
            }}
          >
            <Button variant="ghost" size="xs" onClick={onAdd}>
              <Plus className="w-3.5 h-3.5" />
              {t.media_studio.add_video}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

const VideoLane = memo(VideoLaneImpl);
export default VideoLane;

// ---------------------------------------------------------------------------
// VideoClipBody — real thumbnail strip when extraction succeeds, filmstrip
// fallback otherwise.
// ---------------------------------------------------------------------------

function VideoClipBody({ clip }: { clip: VideoClip }) {
  const frames = useVideoThumbnails(clip.filePath);

  return (
    <div className="relative flex items-center gap-1.5 h-full px-2 overflow-hidden">
      {/* Thumbnail strip OR filmstrip fallback */}
      <div className="absolute inset-0 pointer-events-none">
        {frames && frames.length > 0 ? (
          <div className="h-full flex opacity-60">
            {frames.map((f, i) => (
              <div
                key={i}
                className="h-full flex-1 bg-cover bg-center"
                style={{ backgroundImage: `url(${f})` }}
              />
            ))}
          </div>
        ) : (
          <div className="h-full flex opacity-10">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-full flex-1 border-r border-rose-400" />
            ))}
          </div>
        )}
      </div>
      {/* Dark scrim so the label stays readable over the thumbs */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-black/10 to-transparent pointer-events-none" />
      <Film className="w-3 h-3 text-rose-400 flex-shrink-0 z-10" />
      <span className="text-md text-foreground truncate z-10 drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">
        {clip.label}
      </span>
      <span className="ml-auto text-md text-rose-300/90 bg-black/50 rounded px-1 py-0.5 tabular-nums font-mono font-semibold z-10 flex-shrink-0">
        {formatDurationHuman(clip.duration)}
      </span>
    </div>
  );
}
