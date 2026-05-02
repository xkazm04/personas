import { memo, useCallback } from 'react';
import { Film, Blend, Moon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { formatDurationHuman } from '../utils/format';
import { useVideoThumbnails } from './hooks/useVideoThumbnails';
import type { VideoClip } from './types';
import TimelineClip from './TimelineClip';
import MediaLaneShell, {
  STANDARD_LANE_LAYOUT,
  addButtonLeftPx,
  type LaneTheme,
} from './MediaLaneShell';

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

const VIDEO_THEME: LaneTheme = {
  headerBg: 'bg-rose-500/10',
  headerBorder: 'border-rose-500/20',
  headerText: 'text-rose-400',
  countBadgeBg: 'bg-rose-500/10',
  countBadgeText: 'text-rose-400/60',
  iconText: 'text-rose-400',
  laneBg: 'bg-rose-500/[0.02]',
  emptyHintBorder: 'border-rose-500/15',
  emptyHintText: 'text-rose-400/30',
};

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
    <MediaLaneShell
      itemCount={items.length}
      hideHeader={hideHeader}
      hideAdd={hideAdd}
      onAdd={onAdd}
      Icon={Film}
      labelText={t.media_studio.layer_video}
      emptyText={t.media_studio.empty_lane}
      addButtonText={t.media_studio.add_video}
      addButtonLeftPx={addButtonLeftPx(items, zoom, scrollX)}
      theme={VIDEO_THEME}
      layout={STANDARD_LANE_LAYOUT}
    >
      {/* Transition indicators between clips — VideoLane only */}
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
    </MediaLaneShell>
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
