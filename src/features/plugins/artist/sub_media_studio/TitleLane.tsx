import { memo, useCallback } from 'react';
import { Type } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TitleItem } from './types';
import TimelineClip from './TimelineClip';
import MediaLaneShell, {
  COMPACT_LANE_LAYOUT,
  addButtonLeftPx,
  type LaneTheme,
} from './MediaLaneShell';

interface TitleLaneProps {
  items: TitleItem[];
  zoom: number;
  scrollX: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onUpdate?: (id: string, patch: Partial<TitleItem>) => void;
  hideHeader?: boolean;
  hideAdd?: boolean;
}

/** Sky, so titles read as distinct from the amber beat lane next door — the
 *  two are easy to confuse and mean very different things. */
const TITLE_THEME: LaneTheme = {
  headerBg: 'bg-sky-500/10',
  headerBorder: 'border-sky-500/20',
  headerText: 'text-sky-400',
  countBadgeBg: 'bg-sky-500/10',
  countBadgeText: 'text-sky-400/60',
  iconText: 'text-sky-400',
  laneBg: 'bg-sky-500/[0.02]',
  emptyHintBorder: 'border-sky-500/15',
  emptyHintText: 'text-sky-400/30',
};

/** The rendered typography lane: titles, captions, and numbers that get burned
 *  into the exported frame. Not to be confused with the Text lane, which holds
 *  beats — timeline milestones that are never drawn. */
function TitleLaneImpl({
  items,
  zoom,
  scrollX,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  hideHeader,
  hideAdd,
}: TitleLaneProps) {
  const { t } = useTranslation();

  const handleMove = useCallback(
    (id: string, newStart: number) => {
      onUpdate?.(id, { startTime: newStart });
    },
    [onUpdate],
  );

  const handleTrimLeft = useCallback(
    (id: string, item: TitleItem, delta: number) => {
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
    (id: string, item: TitleItem, delta: number) => {
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
      Icon={Type}
      labelText={t.media_studio.layer_title}
      emptyText={t.media_studio.empty_lane}
      addButtonText={t.media_studio.add_title}
      addButtonLeftPx={addButtonLeftPx(items, zoom, scrollX)}
      theme={TITLE_THEME}
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
          className="top-0.5 h-11 rounded-card overflow-hidden bg-sky-500/15 border border-sky-500/20 hover:border-sky-500/40"
          selectedClassName="top-0.5 h-11 rounded-card overflow-hidden bg-sky-500/15 border-2 border-sky-400 ring-1 ring-sky-400/40 shadow-elevation-1"
          onClick={() => onSelect(item.id)}
          onMove={(newStart) => handleMove(item.id, newStart)}
          onTrimLeft={(delta) => handleTrimLeft(item.id, item, delta)}
          onTrimRight={(delta) => handleTrimRight(item.id, item, delta)}
        >
          <div className="relative w-full h-full flex items-center gap-1.5 px-2 overflow-hidden">
            <Type className="w-3.5 h-3.5 shrink-0 text-sky-400/60" />
            <span className="text-md text-sky-100 truncate">
              {item.text.trim() || t.media_studio.title_untitled}
            </span>
          </div>
        </TimelineClip>
      ))}
    </MediaLaneShell>
  );
}

const TitleLane = memo(TitleLaneImpl);
export default TitleLane;
