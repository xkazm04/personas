import { useCallback } from 'react';
import { Music, Plus, Volume2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import type { AudioClip } from './types';
import TimelineClip from './TimelineClip';

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

export default function AudioLane({
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
    <div className="flex flex-col">
      {/* Lane header */}
      {!hideHeader && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border-b border-blue-500/20">
          <Music className="w-3.5 h-3.5 text-blue-400" />
          <span className="typo-heading text-blue-400 text-xs uppercase tracking-wide">
            {t.media_studio.layer_audio}
          </span>
          {items.length > 0 && (
            <span className="ml-auto text-[9px] text-blue-400/60 bg-blue-500/10 rounded-full px-1.5 py-0.5 font-medium tabular-nums">
              {items.length}
            </span>
          )}
        </div>
      )}

      {/* Clips area */}
      <div className="relative h-14 bg-blue-500/[0.02] border-b border-primary/10">
        {/* Empty lane hint */}
        {items.length === 0 && (
          <div className="absolute inset-1 rounded-lg border border-dashed border-blue-500/15 flex items-center justify-center">
            <span className="text-[10px] text-blue-400/30">{t.media_studio.empty_lane}</span>
          </div>
        )}
        {items.map((clip) => (
          <TimelineClip
            key={clip.id}
            id={clip.id}
            startTime={clip.startTime}
            duration={clip.duration}
            zoom={zoom}
            scrollX={scrollX}
            isSelected={clip.id === selectedId}
            className="top-1 h-12 rounded-lg bg-blue-500/15 border border-blue-500/20 hover:bg-blue-500/25"
            selectedClassName="top-1 h-12 rounded-lg bg-blue-500/30 border-2 border-blue-400 ring-1 ring-blue-400/40"
            onClick={() => onSelect(clip.id)}
            onMove={(newStart) => handleMove(clip.id, newStart)}
            onTrimLeft={(delta) => handleTrimLeft(clip.id, clip, delta)}
            onTrimRight={(delta) => handleTrimRight(clip.id, clip, delta)}
          >
            <div className="relative flex items-center gap-1.5 h-full px-2 overflow-hidden">
              {/* Fake waveform bars */}
              <div className="absolute inset-0 flex items-end gap-px px-1 pb-0.5 pointer-events-none opacity-30">
                {Array.from({ length: Math.min(Math.floor(clip.duration * zoom / 3), 60) }, (_, i) => {
                  const h = 20 + Math.sin(i * 0.7 + clip.id.charCodeAt(0)) * 15 + Math.cos(i * 1.3) * 10;
                  return (
                    <div
                      key={i}
                      className="flex-1 min-w-[1px] bg-blue-400 rounded-t-sm"
                      style={{ height: `${Math.max(4, h * clip.volume)}%` }}
                    />
                  );
                })}
              </div>
              <Music className="w-3 h-3 text-blue-400 flex-shrink-0 z-10" />
              <span className="text-[11px] text-foreground/80 truncate z-10">{clip.label}</span>
              <div className="ml-auto flex items-center gap-0.5 flex-shrink-0 z-10">
                <Volume2 className="w-2.5 h-2.5 text-blue-400/60" />
                <span className="text-[9px] text-blue-400/60 tabular-nums">
                  {Math.round(clip.volume * 100)}%
                </span>
              </div>
            </div>
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
              {t.media_studio.add_audio}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
