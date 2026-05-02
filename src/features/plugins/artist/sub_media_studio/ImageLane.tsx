import { memo, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ImageIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ImageItem } from './types';
import TimelineClip from './TimelineClip';
import MediaLaneShell, {
  COMPACT_LANE_LAYOUT,
  addButtonLeftPx,
  type LaneTheme,
} from './MediaLaneShell';

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

const IMAGE_THEME: LaneTheme = {
  headerBg: 'bg-emerald-500/10',
  headerBorder: 'border-emerald-500/20',
  headerText: 'text-emerald-400',
  countBadgeBg: 'bg-emerald-500/10',
  countBadgeText: 'text-emerald-400/60',
  iconText: 'text-emerald-400',
  laneBg: 'bg-emerald-500/[0.02]',
  emptyHintBorder: 'border-emerald-500/15',
  emptyHintText: 'text-emerald-400/30',
};

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
    <MediaLaneShell
      itemCount={items.length}
      hideHeader={hideHeader}
      hideAdd={hideAdd}
      onAdd={onAdd}
      Icon={ImageIcon}
      labelText={t.media_studio.layer_image}
      emptyText={t.media_studio.empty_lane}
      addButtonText={t.media_studio.add_image}
      addButtonLeftPx={addButtonLeftPx(items, zoom, scrollX)}
      theme={IMAGE_THEME}
      layout={COMPACT_LANE_LAYOUT}
    >
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
    </MediaLaneShell>
  );
}

const ImageLane = memo(ImageLaneImpl);
export default ImageLane;
