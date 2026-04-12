import { ImageIcon, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import type { ImageItem } from './types';

interface ImageLaneProps {
  items: ImageItem[];
  zoom: number;
  scrollX: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

export default function ImageLane({
  items,
  zoom,
  scrollX,
  selectedId,
  onSelect,
  onAdd,
}: ImageLaneProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col">
      {/* Lane header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20">
        <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
        <span className="typo-heading text-emerald-400 text-xs uppercase tracking-wide">
          {t.media_studio.layer_image}
        </span>
        {items.length > 0 && (
          <span className="ml-auto text-[9px] text-emerald-400/60 bg-emerald-500/10 rounded-full px-1.5 py-0.5 font-medium tabular-nums">
            {items.length}
          </span>
        )}
      </div>

      {/* Images area */}
      <div className="relative h-12 bg-card/50 border-b border-primary/10">
        {items.length === 0 && (
          <div className="absolute inset-0.5 rounded-lg border border-dashed border-emerald-500/15 flex items-center justify-center">
            <span className="text-[10px] text-emerald-400/30">{t.media_studio.empty_lane}</span>
          </div>
        )}
        {items.map((item) => {
          const left = item.startTime * zoom - scrollX;
          const width = item.duration * zoom;
          const isSelected = item.id === selectedId;
          return (
            <button
              key={item.id}
              className={`absolute top-0.5 h-11 rounded-lg overflow-hidden cursor-pointer transition-all
                ${isSelected
                  ? 'border-2 border-emerald-400 ring-1 ring-emerald-400/40 shadow-sm'
                  : 'border border-emerald-500/20 hover:border-emerald-500/40'
                }`}
              style={{ left: `${left}px`, width: `${Math.max(width, 28)}px` }}
              onClick={() => onSelect(item.id)}
              title={item.label}
            >
              {/* Thumbnail or placeholder */}
              <div className="w-full h-full bg-emerald-500/15 flex items-center justify-center">
                <ImageIcon className="w-4 h-4 text-emerald-400/60" />
              </div>
              {/* Label overlay at bottom */}
              {width > 50 && (
                <span className="absolute bottom-0 inset-x-0 text-[8px] text-emerald-200 bg-black/40 px-1 truncate">
                  {item.label}
                </span>
              )}
            </button>
          );
        })}

        {/* Add button */}
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
      </div>
    </div>
  );
}
