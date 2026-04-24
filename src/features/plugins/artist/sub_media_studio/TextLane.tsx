import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Plus, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import type { BeatAnchor, TextItem, VideoClip } from './types';

interface TextLaneProps {
  items: TextItem[];
  zoom: number;
  scrollX: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<TextItem>) => void;
  /** Video clips in the composition — used to populate the anchor-word
   *  picker in the beat-edit modal. Only clips with a transcript can be
   *  anchor sources. */
  videoClips?: VideoClip[];
  hideHeader?: boolean;
  hideAdd?: boolean;
}

/** Modal for editing a beat's word, description, and optional word-anchor. */
function BeatEditModal({
  item,
  videoClips,
  onSave,
  onClose,
}: {
  item: TextItem;
  videoClips: VideoClip[];
  onSave: (patch: { label: string; text: string; anchor: BeatAnchor | undefined }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [word, setWord] = useState(item.label);
  const [description, setDescription] = useState(item.text);
  const anchorableClips = videoClips.filter((c) => c.transcriptPath);
  const [anchorMode, setAnchorMode] = useState<'manual' | 'word'>(
    item.anchor ? 'word' : 'manual',
  );
  const [anchorClipId, setAnchorClipId] = useState(
    item.anchor?.videoClipId ?? anchorableClips[0]?.id ?? '',
  );
  const [anchorWord, setAnchorWord] = useState(item.anchor?.word ?? '');
  const [anchorOccurrence, setAnchorOccurrence] = useState(item.anchor?.occurrence ?? 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-background border border-primary/10 rounded-2xl p-6 w-full max-w-md shadow-elevation-4"
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
            rows={3}
            className="w-full px-3 py-2 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 resize-none"
          />

          {/* Anchor section */}
          <div className="border-t border-primary/10 pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="typo-label text-foreground">{t.media_studio.anchor_section}</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-md text-foreground cursor-pointer">
                <input
                  type="radio"
                  checked={anchorMode === 'manual'}
                  onChange={() => setAnchorMode('manual')}
                />
                {t.media_studio.anchor_manual}
              </label>
              <label className={`flex items-center gap-1.5 text-md cursor-pointer ${anchorableClips.length === 0 ? 'text-foreground/40 cursor-not-allowed' : 'text-foreground'}`}>
                <input
                  type="radio"
                  checked={anchorMode === 'word'}
                  onChange={() => setAnchorMode('word')}
                  disabled={anchorableClips.length === 0}
                />
                {t.media_studio.anchor_word_mode}
              </label>
            </div>
            {anchorMode === 'word' && anchorableClips.length === 0 && (
              <p className="text-[11px] text-foreground/60">{t.media_studio.anchor_no_transcripts}</p>
            )}
            {anchorMode === 'word' && anchorableClips.length > 0 && (
              <div className="grid grid-cols-[1fr_2fr_auto] gap-2">
                <select
                  value={anchorClipId}
                  onChange={(e) => setAnchorClipId(e.target.value)}
                  className="px-2 py-1.5 text-md bg-secondary/40 border border-primary/10 rounded-card text-foreground"
                  aria-label={t.media_studio.anchor_clip}
                >
                  {anchorableClips.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input
                  value={anchorWord}
                  onChange={(e) => setAnchorWord(e.target.value)}
                  placeholder={t.media_studio.anchor_word_placeholder}
                  className="px-2 py-1.5 text-md bg-secondary/40 border border-primary/10 rounded-card text-foreground placeholder:text-foreground/40"
                  aria-label={t.media_studio.anchor_word}
                />
                <input
                  type="number"
                  min={1}
                  value={anchorOccurrence}
                  onChange={(e) => setAnchorOccurrence(Math.max(1, Number(e.target.value) || 1))}
                  className="w-14 px-2 py-1.5 text-md bg-secondary/40 border border-primary/10 rounded-card text-foreground tabular-nums"
                  aria-label={t.media_studio.anchor_occurrence}
                  title={t.media_studio.anchor_occurrence_hint}
                />
              </div>
            )}
          </div>
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
              let anchor: BeatAnchor | undefined;
              if (anchorMode === 'word' && anchorClipId && anchorWord.trim()) {
                anchor = {
                  videoClipId: anchorClipId,
                  word: anchorWord.trim(),
                  occurrence: anchorOccurrence,
                };
              }
              onSave({
                label: word.trim() || item.label,
                text: description,
                anchor,
              });
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
  videoClips,
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
          videoClips={videoClips ?? []}
          onSave={({ label, text, anchor }) => {
            onUpdate(editingItem.id, { label, text, anchor });
          }}
          onClose={() => setEditingItem(null)}
        />
      )}
    </>
  );
}

const TextLane = memo(TextLaneImpl);
export default TextLane;
