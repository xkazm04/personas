import { memo, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ImageIcon, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import type { ImageItem } from './types';
import TimelineClip from './TimelineClip';

interface ImageLaneProps {
  items: ImageItem[];
  zoom: number;
  scrollX: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onUpdate?: (id: string, patch: Partial<ImageItem>) => void;
  hideHeader?: boolean;
  hideAdd?: boolean;
}

function ImageLaneImpl({
  items,
  zoom,
  scrollX,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  hideHeader,
  hideAdd,
}: ImageLaneProps) {
  const { t } = useTranslation();

  const handleMove = useCallback(
    (id: string, newStart: number) => {
      onUpdate?.(id, { startTime: newStart });
    },
    [onUpdate],
  );

  const handleTrimLeft = useCallback(
    (id: string, item: ImageItem, delta: number) => {
      const newStart = Math.max(0, item.startTime + delta);
      const actualDelta = newStart - item.startTime;
      onUpdate?.(id, {
        startTime: newStart,
        duration: Math.max(0.25, item.duration - actualDelta),
      });
    },
    [onUpdate],
  );

  const handleTrimRight = useCallback(
    (id: string, item: ImageItem, delta: number) => {
      onUpdate?.(id, { duration: Math.max(0.25, item.duration + delta) });
    },
    [onUpdate],
  );

  return (
    <div className="flex flex-col">
      {/* Lane header */}
      {!hideHeader && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20">
          <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
          <span className="typo-label text-emerald-400">
            {t.media_studio.layer_image}
          </span>
          {items.length > 0 && (
            <span className="ml-auto text-md text-emerald-400/60 bg-emerald-500/10 rounded-full px-1.5 py-0.5 tabular-nums">
              {items.length}
            </span>
          )}
        </div>
      )}

      {/* Images area */}
      <div className="relative h-12 bg-emerald-500/[0.02] border-b border-primary/10">
        {items.length === 0 && (
          <div className="absolute inset-0.5 rounded-card border border-dashed border-emerald-500/15 flex items-center justify-center">
            <span className="text-md text-emerald-400/30">{t.media_studio.empty_lane}</span>
          </div>
        )}
        {items.map((item) => (
          <TimelineClip
            key={item.id}
            id={item.id}
            startTime={item.startTime}
            duration={item.duration}
            zoom={zoom}
            scrollX={scrollX}
            isSelected={item.id === selectedId}
            className="top-0.5 h-11 rounded-card overflow-hidden bg-emerald-500/15 border border-emerald-500/20 hover:border-emerald-500/40"
            selectedClassName="top-0.5 h-11 rounded-card overflow-hidden bg-emerald-500/15 border-2 border-emerald-400 ring-1 ring-emerald-400/40 shadow-elevation-1"
            onClick={() => onSelect(item.id)}
            onMove={(newStart) => handleMove(item.id, newStart)}
            onTrimLeft={(delta) => handleTrimLeft(item.id, item, delta)}
            onTrimRight={(delta) => handleTrimRight(item.id, item, delta)}
          >
            <div className="relative w-full h-full bg-emerald-500/5 flex items-center justify-center overflow-hidden">
              <img
                src={convertFileSrc(item.filePath)}
                alt={item.label}
                className="w-full h-full object-cover opacity-80"
                draggable={false}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
              <ImageIcon className="absolute w-4 h-4 text-emerald-400/40" />
              {item.duration * zoom > 50 && (
                <span className="absolute bottom-0 inset-x-0 text-md text-emerald-200 bg-black/50 px-1 truncate">
                  {item.label}
                </span>
              )}
            </div>
          </TimelineClip>
        ))}

        {/* Add button */}
        {!hideAdd && (
          <div
            className="absolute top-0.5 h-11 flex items-center"
            style={{
              left: `${items.length > 0
                ? Math.max(...items.map((c) => (c.startTime + c.duration) * zoom - scrollX)) + 8
                : 8
              }px`,
            }}
          >
            <Button variant="ghost" size="xs" onClick={onAdd}>
              <Plus className="w-3.5 h-3.5" />
              {t.media_studio.add_image}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

const ImageLane = memo(ImageLaneImpl);
export default ImageLane;
