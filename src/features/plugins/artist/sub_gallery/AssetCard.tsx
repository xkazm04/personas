import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Check, Trash2, Tag, Box, Loader2, Film } from 'lucide-react';
import type { ArtistAsset } from '@/api/artist';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useLocalImage } from '../hooks/useLocalImage';
import { formatFileSize } from '../utils/format';
import TagEditorModal from './TagEditorModal';

interface AssetCardProps {
  asset: ArtistAsset;
  onDelete: (id: string) => void;
  onUpdateTags: (id: string, tags: string) => void;
  onClick?: () => void;
  /** When true, the card is part of a selection set — render highlighted. */
  selected?: boolean;
  /** When true, primary click toggles selection instead of running `onClick`. */
  inSelectMode?: boolean;
  /** Toggle this card's selection. Receives the original MouseEvent so callers
   *  can pick up modifiers like shiftKey for range-select. */
  onToggleSelect?: (e: ReactMouseEvent) => void;
}

export default function AssetCard({
  asset,
  onDelete,
  onUpdateTags,
  onClick,
  selected = false,
  inSelectMode = false,
  onToggleSelect,
}: AssetCardProps) {
  const { t } = useTranslation();
  const [editingTags, setEditingTags] = useState(false);
  const queueMediaStudioAsset = useSystemStore((s) => s.queueMediaStudioAsset);
  const setArtistTab = useSystemStore((s) => s.setArtistTab);
  const isImage = asset.assetType === '2d';
  const sizeStr = formatFileSize(asset.fileSize);
  const ext = asset.fileName.split('.').pop()?.toUpperCase() ?? '';
  const dataUrl = useLocalImage(isImage ? asset.filePath : null);

  const sendToMediaStudio = () => {
    queueMediaStudioAsset({
      id: asset.id,
      filePath: asset.filePath,
      fileName: asset.fileName,
    });
    setArtistTab('media-studio');
    useToastStore.getState().addToast(t.plugins.artist.sent_to_media_studio, 'success');
  };

  const handleCardClick = (e: ReactMouseEvent) => {
    // In select mode, primary click toggles the card instead of opening the
    // viewer; shift+click extends the selection range. The user exits select
    // mode by clicking the selection bar's clear button.
    if (inSelectMode && onToggleSelect) {
      onToggleSelect(e);
      return;
    }
    onClick?.();
  };

  const borderClass = selected
    ? 'border-rose-500/60 shadow-elevation-3 shadow-rose-500/10'
    : 'border-primary/8 hover:border-rose-500/20 hover:shadow-elevation-3 hover:shadow-rose-500/5';

  return (
    <div
      className={`group relative rounded-modal border ${borderClass} bg-card/40 overflow-hidden transition-all cursor-pointer`}
      onClick={handleCardClick}
    >
      {onToggleSelect && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(e);
          }}
          aria-label={selected ? t.plugins.artist.gallery_deselect : t.plugins.artist.gallery_select}
          aria-pressed={selected}
          className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
            selected
              ? 'bg-rose-500 border-rose-500 text-white'
              : 'bg-black/40 border-white/50 opacity-0 group-hover:opacity-100 hover:border-white'
          }`}
        >
          {selected && <Check className="w-3 h-3" strokeWidth={3} />}
        </button>
      )}

      {/* Thumbnail area */}
      <div className="relative aspect-square bg-background/60 flex items-center justify-center overflow-hidden">
        {isImage && dataUrl ? (
          <img
            src={dataUrl}
            alt={asset.fileName}
            width={400}
            height={400}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : isImage && !dataUrl ? (
          <Loader2 className="w-5 h-5 text-foreground animate-spin" />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Box className="w-10 h-10 text-rose-400" />
            <span className="text-md font-mono text-foreground uppercase">{ext}</span>
          </div>
        )}

        {/* Hover overlay — gated via CSS group-hover so the parent doesn't
            need to re-render on every pointer enter/leave. */}
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(asset.id);
            }}
            className="p-2 rounded-card bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            title={t.plugins.artist.delete}
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditingTags(true);
            }}
            className="p-2 rounded-card bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
            title={t.plugins.artist.edit_tags}
          >
            <Tag className="w-4 h-4" />
          </button>
          {isImage && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                sendToMediaStudio();
              }}
              className="p-2 rounded-card bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 transition-colors"
              title={t.plugins.artist.send_to_media_studio}
            >
              <Film className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="px-3 py-2 space-y-0.5">
        <p className="typo-card-label truncate">{asset.fileName}</p>
        <div className="flex items-center gap-2 text-md text-foreground">
          <span>{ext}</span>
          <span>&middot;</span>
          <span>{sizeStr}</span>
        </div>
        {asset.tags && (
          <div className="flex flex-wrap gap-1 mt-1">
            {asset.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => (
              <span
                key={t}
                className="px-1.5 py-0.5 rounded text-md bg-rose-500/10 text-rose-400"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {editingTags && (
        <TagEditorModal
          assetLabel={asset.fileName}
          initialTags={asset.tags ?? ''}
          onSave={(tags) => onUpdateTags(asset.id, tags)}
          onClose={() => setEditingTags(false)}
        />
      )}
    </div>
  );
}
