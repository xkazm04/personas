import { useState, useCallback, type DragEvent } from 'react';
import { ChevronRight, ChevronLeft, Pin, X, ImageOff } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useLocalImage } from '../hooks/useLocalImage';
import type { ReferenceBoardItem } from '@/stores/slices/system/artistSlice';

export const REFERENCE_DRAG_MIME = 'application/x-artist-asset+json';

interface DraggedAssetPayload {
  assetId: string;
  filePath: string;
  fileName: string;
  tags: string | null;
  assetType: '2d' | '3d';
}

/**
 * Reference mood board — a collapsible right-edge dock for the Creative
 * Studio. Users drag image assets from the gallery onto the dock to pin
 * them as visual references; the next outgoing prompt is augmented with
 * an auto-generated descriptive context block keyed off each reference's
 * tags + filename + weight. The dock supports drag-to-reorder and a
 * per-reference weight slider.
 */
export default function ReferenceBoard() {
  const { t, tx } = useTranslation();
  const {
    referenceBoard,
    referenceBoardOpen,
    setReferenceBoardOpen,
    pinReference,
    unpinReference,
    setReferenceWeight,
    reorderReferences,
    clearReferenceBoard,
  } = useSystemStore(
    useShallow((s) => ({
      referenceBoard: s.referenceBoard,
      referenceBoardOpen: s.referenceBoardOpen,
      setReferenceBoardOpen: s.setReferenceBoardOpen,
      pinReference: s.pinReference,
      unpinReference: s.unpinReference,
      setReferenceWeight: s.setReferenceWeight,
      reorderReferences: s.reorderReferences,
      clearReferenceBoard: s.clearReferenceBoard,
    })),
  );

  const [dropActive, setDropActive] = useState(false);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes(REFERENCE_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropActive(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Only clear when leaving the dock entirely; child enter/leave fires
    // many times during reorder hover.
    if (e.currentTarget === e.target) setDropActive(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDropActive(false);
    const raw = e.dataTransfer.getData(REFERENCE_DRAG_MIME);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as DraggedAssetPayload;
      if (payload.assetType !== '2d') return;
      const before = useSystemStore.getState().referenceBoard.length;
      pinReference({
        assetId: payload.assetId,
        filePath: payload.filePath,
        fileName: payload.fileName,
        tags: payload.tags,
      });
      const after = useSystemStore.getState().referenceBoard.length;
      const toast = useToastStore.getState().addToast;
      if (after === before) {
        toast(t.plugins.artist.moodboard_already_pinned, 'success');
      } else {
        toast(t.plugins.artist.moodboard_pinned, 'success');
      }
    } catch (err) {
      // Drop payload was malformed (non-JSON or wrong shape) — ignore the drop
      // but leave a breadcrumb so a broken drag source is diagnosable.
      silentCatch('artist/ReferenceBoard:handleDrop')(err);
    }
  }, [pinReference, t]);

  const handleClear = useCallback(() => {
    if (referenceBoard.length === 0) return;
    const message =
      referenceBoard.length === 1
        ? t.plugins.artist.moodboard_clear_confirm_one
        : tx(t.plugins.artist.moodboard_clear_confirm_other, { count: referenceBoard.length });
    if (window.confirm(message)) clearReferenceBoard();
  }, [referenceBoard.length, clearReferenceBoard, t, tx]);

  // Collapsed: a slim tab on the right edge that pops the dock open.
  if (!referenceBoardOpen) {
    return (
      <button
        onClick={() => setReferenceBoardOpen(true)}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-1 px-2 py-3 rounded-l-modal border border-r-0 border-primary/15 bg-card/80 backdrop-blur hover:bg-card hover:border-rose-500/30 transition-colors"
        title={t.plugins.artist.moodboard_show}
      >
        <ChevronLeft className="w-4 h-4 text-rose-400" />
        <Pin className="w-3.5 h-3.5 text-foreground" />
        {referenceBoard.length > 0 && (
          <span className="px-1 py-0.5 rounded-full bg-rose-500/20 text-rose-400 text-md leading-none min-w-[18px] text-center">
            {referenceBoard.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      role="region"
      aria-label={t.plugins.artist.moodboard_title}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`fixed right-0 top-16 bottom-4 z-30 w-72 flex flex-col rounded-l-modal border border-r-0 border-primary/15 bg-card/95 backdrop-blur shadow-elevation-3 transition-colors ${
        dropActive ? 'border-rose-500/60 bg-rose-500/5' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
        <div className="flex items-center gap-2 min-w-0">
          <Pin className="w-4 h-4 text-rose-400 shrink-0" />
          <h3 className="typo-card-label truncate">{t.plugins.artist.moodboard_title}</h3>
          {referenceBoard.length > 0 && (
            <span className="text-md text-foreground">
              {referenceBoard.length === 1
                ? t.plugins.artist.moodboard_count_one
                : tx(t.plugins.artist.moodboard_count_other, { count: referenceBoard.length })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {referenceBoard.length > 0 && (
            <button
              onClick={handleClear}
              className="text-md text-foreground hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-red-500/10 transition-colors"
              title={t.plugins.artist.moodboard_clear}
            >
              {t.plugins.artist.moodboard_clear}
            </button>
          )}
          <button
            onClick={() => setReferenceBoardOpen(false)}
            className="p-1 rounded hover:bg-secondary/40 text-foreground"
            title={t.plugins.artist.moodboard_hide}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-2">
        {referenceBoard.length === 0 ? (
          <EmptyDropZone active={dropActive} />
        ) : (
          <ul className="space-y-2">
            {referenceBoard.map((item, idx) => (
              <ReferenceCard
                key={item.assetId}
                item={item}
                index={idx}
                onRemove={() => unpinReference(item.assetId)}
                onWeightChange={(w) => setReferenceWeight(item.assetId, w)}
                onReorder={(toIndex) => reorderReferences(item.assetId, toIndex)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-primary/10 text-md text-foreground leading-snug">
        {t.plugins.artist.moodboard_hint}
      </div>
    </div>
  );
}

function EmptyDropZone({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      className={`h-full min-h-[200px] flex flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed transition-colors p-4 ${
        active
          ? 'border-rose-400/60 bg-rose-500/5 text-rose-400'
          : 'border-primary/15 text-foreground'
      }`}
    >
      <Pin className={`w-8 h-8 ${active ? 'text-rose-400' : 'text-foreground/40'}`} />
      <div className="space-y-1 text-center">
        <p className="typo-card-label">
          {active ? t.plugins.artist.moodboard_drop_here : t.plugins.artist.moodboard_empty_title}
        </p>
        {!active && (
          <p className="text-md text-foreground leading-snug">
            {t.plugins.artist.moodboard_empty_hint}
          </p>
        )}
      </div>
    </div>
  );
}

interface ReferenceCardProps {
  item: ReferenceBoardItem;
  index: number;
  onRemove: () => void;
  onWeightChange: (weight: number) => void;
  onReorder: (toIndex: number) => void;
}

function ReferenceCard({ item, index, onRemove, onWeightChange, onReorder }: ReferenceCardProps) {
  const { t } = useTranslation();
  const dataUrl = useLocalImage(item.filePath);
  const [dragOver, setDragOver] = useState(false);

  // Reorder uses a private mime so it doesn't collide with new-pin drops.
  const REORDER_MIME = 'application/x-artist-moodboard-reorder';

  const handleDragStart = (e: DragEvent<HTMLLIElement>) => {
    e.dataTransfer.setData(REORDER_MIME, item.assetId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: DragEvent<HTMLLIElement>) => {
    if (e.dataTransfer.types.includes(REORDER_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOver(true);
    }
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    setDragOver(false);
    const fromId = e.dataTransfer.getData(REORDER_MIME);
    if (fromId && fromId !== item.assetId) onReorder(index);
  };

  return (
    <li
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group relative rounded-card border bg-background/40 overflow-hidden cursor-grab active:cursor-grabbing transition-colors ${
        dragOver ? 'border-rose-400/60 bg-rose-500/5' : 'border-primary/10 hover:border-rose-500/20'
      }`}
    >
      <div className="flex gap-2 p-2">
        {/* Thumbnail */}
        <div className="w-14 h-14 rounded bg-background/60 flex items-center justify-center overflow-hidden shrink-0">
          {dataUrl ? (
            <img
              src={dataUrl}
              alt={item.fileName}
              width={56}
              height={56}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          ) : (
            <ImageOff className="w-5 h-5 text-foreground/40" />
          )}
        </div>

        {/* Info + controls */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-1">
            <p className="typo-card-label truncate" title={item.fileName}>
              {item.fileName}
            </p>
            <button
              onClick={onRemove}
              className="p-0.5 rounded hover:bg-red-500/15 text-foreground hover:text-red-400 transition-colors shrink-0"
              title={t.plugins.artist.moodboard_unpin}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {item.tags && (
            <div className="flex flex-wrap gap-1 mt-1">
              {item.tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean)
                .slice(0, 3)
                .map((tag) => (
                  <span
                    key={tag}
                    className="px-1 py-0.5 rounded text-md bg-rose-500/10 text-rose-400 leading-none"
                  >
                    {tag}
                  </span>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Weight slider */}
      <div className="flex items-center gap-2 px-2 pb-2">
        <label
          className="text-md text-foreground shrink-0"
          title={t.plugins.artist.moodboard_weight_help}
        >
          {t.plugins.artist.moodboard_weight_label}
        </label>
        <input
          type="range"
          min={0.1}
          max={2}
          step={0.1}
          value={item.weight}
          onChange={(e) => onWeightChange(parseFloat(e.target.value))}
          className="flex-1 accent-rose-500"
          aria-label={t.plugins.artist.moodboard_weight_label}
        />
        <span className="text-md text-foreground font-mono w-9 text-right tabular-nums">
          {item.weight.toFixed(1)}
        </span>
      </div>
    </li>
  );
}
