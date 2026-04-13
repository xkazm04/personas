import { useState } from 'react';
import { Type, Plus, X } from 'lucide-react';
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

/** Modal for editing a text beat's expanded description. */
function BeatEditModal({
  item,
  onSave,
  onClose,
}: {
  item: TextItem;
  onSave: (word: string, text: string) => void;
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
          <h3 className="typo-heading text-foreground">{t.media_studio.beat_word}</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-3">
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder={t.media_studio.beat_word_placeholder}
            className="w-full px-3 py-2 text-sm font-semibold bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30"
            autoFocus
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.media_studio.beat_description_placeholder}
            rows={4}
            className="w-full px-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 resize-none"
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

export default function TextLane({
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

  return (
    <>
      <div className="flex flex-col">
        {/* Lane header */}
        {!hideHeader && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20">
            <Type className="w-3.5 h-3.5 text-amber-400" />
            <span className="typo-heading text-amber-400 text-xs uppercase tracking-wide">
              {t.media_studio.layer_text}
            </span>
            {items.length > 0 && (
              <span className="ml-auto text-[9px] text-amber-400/60 bg-amber-500/10 rounded-full px-1.5 py-0.5 font-medium tabular-nums">
                {items.length}
              </span>
            )}
          </div>
        )}

        {/* Beats area */}
        <div className="relative h-10 bg-amber-500/[0.02] border-b border-primary/10">
          {items.length === 0 && (
            <div className="absolute inset-0.5 rounded-lg border border-dashed border-amber-500/15 flex items-center justify-center">
              <span className="text-[10px] text-amber-400/30">{t.media_studio.empty_lane}</span>
            </div>
          )}
          {items.map((item) => {
            const left = item.startTime * zoom - scrollX;
            const width = item.duration * zoom;
            const isSelected = item.id === selectedId;
            return (
              <button
                key={item.id}
                className={`absolute top-0.5 h-9 rounded-lg px-2 flex items-center gap-1 overflow-hidden cursor-pointer transition-all
                  ${isSelected
                    ? 'bg-amber-500/30 border-2 border-amber-400 ring-1 ring-amber-400/40 shadow-sm'
                    : 'bg-amber-500/15 border border-amber-500/20 hover:bg-amber-500/25'
                  }`}
                style={{ left: `${left}px`, width: `${Math.max(width, 32)}px` }}
                onClick={() => onSelect(item.id)}
                onDoubleClick={() => setEditingItem(item)}
                title={item.text || item.label}
              >
                <span className="text-[11px] font-bold text-amber-200 truncate">
                  {item.label}
                </span>
              </button>
            );
          })}

          {/* Add button */}
          {!hideAdd && (
            <div
              className="absolute top-0.5 h-9 flex items-center"
              style={{
                left: `${items.length > 0
                  ? Math.max(...items.map((c) => (c.startTime + c.duration) * zoom - scrollX)) + 8
                  : 8
                }px`,
              }}
            >
              <Button variant="ghost" size="xs" onClick={onAdd}>
                <Plus className="w-3.5 h-3.5" />
                {t.media_studio.add_text_beat}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Beat edit modal */}
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
