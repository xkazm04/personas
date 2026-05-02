import { memo, useCallback, useMemo } from 'react';
import { Music, Volume2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { AudioClip } from './types';
import TimelineClip from './TimelineClip';
import MediaLaneShell, {
  STANDARD_LANE_LAYOUT,
  addButtonLeftPx,
  type LaneTheme,
} from './MediaLaneShell';
import { useAudioWaveform, WAVEFORM_BUCKETS } from './hooks/useAudioWaveform';

interface AudioLaneProps {
  items: AudioClip[];
  zoom: number;
  scrollX: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onUpdate?: (id: string, patch: Partial<AudioClip>) => void;
  hideHeader?: boolean;
  hideAdd?: boolean;
}

const AUDIO_THEME: LaneTheme = {
  headerBg: 'bg-blue-500/10',
  headerBorder: 'border-blue-500/20',
  headerText: 'text-blue-400',
  countBadgeBg: 'bg-blue-500/10',
  countBadgeText: 'text-blue-400/60',
  iconText: 'text-blue-400',
  laneBg: 'bg-blue-500/[0.02]',
  emptyHintBorder: 'border-blue-500/15',
  emptyHintText: 'text-blue-400/30',
};

function AudioLaneImpl({
  items,
  zoom,
  scrollX,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  hideHeader,
  hideAdd,
}: AudioLaneProps) {
  const { t } = useTranslation();

  const handleMove = useCallback(
    (id: string, newStartTime: number) => {
      onUpdate?.(id, { startTime: newStartTime });
    },
    [onUpdate],
  );

  const handleTrimLeft = useCallback(
    (id: string, clip: AudioClip, delta: number) => {
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
    (id: string, clip: AudioClip, delta: number) => {
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
      Icon={Music}
      labelText={t.media_studio.layer_audio}
      emptyText={t.media_studio.empty_lane}
      addButtonText={t.media_studio.add_audio}
      addButtonLeftPx={addButtonLeftPx(items, zoom, scrollX)}
      theme={AUDIO_THEME}
      layout={STANDARD_LANE_LAYOUT}
    >
      {items.map((clip) => (
        <TimelineClip
          key={clip.id}
          id={clip.id}
          startTime={clip.startTime}
          duration={clip.duration}
          zoom={zoom}
          scrollX={scrollX}
          isSelected={clip.id === selectedId}
          className="top-1 h-12 rounded-card bg-blue-500/15 border border-blue-500/20 hover:bg-blue-500/25"
          selectedClassName="top-1 h-12 rounded-card bg-blue-500/30 border-2 border-blue-400 ring-1 ring-blue-400/40"
          onClick={() => onSelect(clip.id)}
          onMove={(newStart) => handleMove(clip.id, newStart)}
          onTrimLeft={(delta) => handleTrimLeft(clip.id, clip, delta)}
          onTrimRight={(delta) => handleTrimRight(clip.id, clip, delta)}
        >
          <AudioClipBody clip={clip} />
        </TimelineClip>
      ))}
    </MediaLaneShell>
  );
}

const AudioLane = memo(AudioLaneImpl);
export default AudioLane;

// ---------------------------------------------------------------------------
// AudioClipBody — renders the real decoded waveform when available, falls
// back to a deterministic pseudo-waveform while loading or on decode error.
// ---------------------------------------------------------------------------

function AudioClipBody({ clip }: { clip: AudioClip }) {
  const peaks = useAudioWaveform(clip.filePath);

  // Deterministic fallback derived from the clip id — never flashes between
  // frames because the seed is stable.
  const fallbackPeaks = useMemo(() => {
    const seed = clip.id.charCodeAt(0) || 1;
    const arr = new Float32Array(60);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = (0.3 + 0.35 * Math.abs(Math.sin(i * 0.7 + seed))
        + 0.2 * Math.abs(Math.cos(i * 1.3 + seed * 0.5)));
    }
    return arr;
  }, [clip.id]);

  const data = peaks ?? fallbackPeaks;
  const buckets = peaks ? WAVEFORM_BUCKETS : fallbackPeaks.length;
  // Represent trim on the rendered waveform: if the clip is trimmed, only
  // show the slice corresponding to the visible window.
  const mediaDuration = Math.max(0.001, clip.mediaDuration);
  const startFrac = Math.max(0, Math.min(1, clip.trimStart / mediaDuration));
  const endFrac = Math.max(startFrac, Math.min(1, (clip.trimStart + clip.duration) / mediaDuration));
  const sliceStart = Math.floor(startFrac * buckets);
  const sliceEnd = Math.max(sliceStart + 1, Math.floor(endFrac * buckets));
  const slice: number[] = [];
  for (let i = sliceStart; i < sliceEnd; i++) {
    slice.push(data[i] ?? 0);
  }

  const volume = clip.volume ?? 1;

  return (
    <div className="relative flex items-center gap-1.5 h-full px-2 overflow-hidden">
      {/* Waveform */}
      <div className="absolute inset-0 flex items-center px-1 pointer-events-none">
        <svg
          className="w-full h-full opacity-40"
          preserveAspectRatio="none"
          viewBox={`0 0 ${Math.max(1, slice.length)} 100`}
        >
          {slice.map((v, i) => {
            const h = Math.max(2, v * 90 * volume);
            return (
              <rect
                key={i}
                x={i}
                y={50 - h / 2}
                width={0.9}
                height={h}
                className="fill-blue-400"
              />
            );
          })}
        </svg>
      </div>
      <Music className="w-3 h-3 text-blue-400 flex-shrink-0 z-10" />
      <span className="text-md text-foreground truncate z-10">{clip.label}</span>
      <div className="ml-auto flex items-center gap-0.5 flex-shrink-0 z-10">
        <Volume2 className="w-2.5 h-2.5 text-blue-400/60" />
        <span className="text-md text-blue-400/60 tabular-nums">
          {Math.round(volume * 100)}%
        </span>
      </div>
    </div>
  );
}
