import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Plus, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import type { TextItem } from './types';

interface TextLaneProps {
  items: TextItem[];
  zoom: number;
  scrollX: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<TextItem>) => void;
  hideHeader?: boolean;
  hideAdd?: boolean;
}

/** Modal for editing a beat's word + longer description. */
function BeatEditModal({
  item,
  onSave,
  onClose,
}: {
  item: TextItem;
  onSave: (word: string, description: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [word, setWord] = useState(item.label);
  const [description, setDescription] = useState(item.text);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-background border border-primary/10 rounded-2xl p-6 w-full max-w-sm shadow-elevation-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="typo-section-title">{t.media_studio.beat_word}</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-3">
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder={t.media_studio.beat_word_placeholder}
            className="w-full px-3 py-2 text-md font-semibold bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30"
            autoFocus
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.media_studio.beat_description_placeholder}
            rows={4}
            className="w-full px-3 py-2 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            variant="accent"
            accentColor="amber"
            size="sm"
            onClick={() => {
              onSave(word.trim() || item.label, description);
              onClose();
            }}
          >
            {t.common.save}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Single beat marker — a vertical pin at the beat's start time. No clip
 * bar, no trim handles: beats are milestones, not rendered ranges. Drag
 * the pin horizontally to reschedule the beat; double-click to edit the
 * description.
 */
function BeatMarker({
  item,
  zoom,
  scrollX,
  isSelected,
  onSelect,
  onDoubleClick,
  onMove,
}: {
  item: TextItem;
  zoom: number;
  scrollX: number;
  isSelected: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onMove: (newStartTime: number) => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startClientX: number; startTime: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      onSelect();
      dragRef.current = { startClientX: e.clientX, startTime: item.startTime };
      anchorRef.current?.setPointerCapture(e.pointerId);
    },
    [item.startTime, onSelect],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startClientX;
      const deltaSeconds = dx / zoom;
      onMove(Math.max(0, dragRef.current.startTime + deltaSeconds));
    },
    [onMove, zoom],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    anchorRef.current?.releasePointerCapture(e.pointerId);
  }, []);

  const left = item.startTime * zoom - scrollX;

  return (
    <div
      ref={anchorRef}
      className="absolute top-0 h-full flex flex-col items-center cursor-grab active:cursor-grabbing select-none"
      style={{ left: `${left}px`, transform: 'translateX(-50%)' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      title={item.label}
    >
      <div
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-card border transition-colors ${
          isSelected
            ? 'bg-amber-500/30 border-amber-400 ring-1 ring-amber-400/40 shadow-elevation-1'
            : 'bg-amber-500/15 border-amber-500/20 hover:bg-amber-500/25'
        }`}
      >
        <MapPin className={`w-3 h-3 ${isSelected ? 'text-amber-300' : 'text-amber-400'}`} />
        <span className="text-[10px] font-semibold text-amber-200 max-w-[96px] truncate">
          {item.label}
        </span>
      </div>
      <div
        className={`w-px flex-1 ${
          isSelected ? 'bg-amber-400/70' : 'bg-amber-500/40'
        }`}
        aria-hidden
      />
    </div>
  );
}

function TextLaneImpl({
  items,
  zoom,
  scrollX,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  hideHeader,
  hideAdd,
}: TextLaneProps) {
  const { t } = useTranslation();
  const [editingItem, setEditingItem] = useState<TextItem | null>(null);

  // Keep editingItem in sync with the latest item state (e.g., after a move).
  useEffect(() => {
    if (!editingItem) return;
    const fresh = items.find((it) => it.id === editingItem.id);
    if (!fresh) setEditingItem(null);
  }, [items, editingItem]);

  return (
    <>
      <div className="flex flex-col">
        {!hideHeader && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20">
            <MapPin className="w-3.5 h-3.5 text-amber-400" />
            <span className="typo-label text-amber-400">{t.media_studio.layer_text}</span>
            {items.length > 0 && (
              <span className="ml-auto text-md text-amber-400/60 bg-amber-500/10 rounded-full px-1.5 py-0.5 tabular-nums">
                {items.length}
              </span>
            )}
          </div>
        )}

        <div className="relative h-10 bg-amber-500/[0.02] border-b border-primary/10 overflow-hidden">
          {items.length === 0 && (
            <div className="absolute inset-0.5 rounded-card border border-dashed border-amber-500/15 flex items-center justify-center">
              <span className="text-md text-amber-400/30">{t.media_studio.empty_lane}</span>
            </div>
          )}

          {items.map((item) => (
            <BeatMarker
              key={item.id}
              item={item}
              zoom={zoom}
              scrollX={scrollX}
              isSelected={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
              onDoubleClick={() => setEditingItem(item)}
              onMove={(newStart) => onUpdate(item.id, { startTime: newStart })}
            />
          ))}

          {!hideAdd && (
            <div className="absolute top-0.5 right-2 h-9 flex items-center">
              <Button variant="ghost" size="xs" onClick={onAdd}>
                <Plus className="w-3.5 h-3.5" />
                {t.media_studio.add_text_beat}
              </Button>
            </div>
          )}
        </div>
      </div>

      {editingItem && (
        <BeatEditModal
          item={editingItem}
          onSave={(word, text) => {
            onUpdate(editingItem.id, { label: word, text });
          }}
          onClose={() => setEditingItem(null)}
        />
      )}
    </>
  );
}

const TextLane = memo(TextLaneImpl);
export default TextLane;
