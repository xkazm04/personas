import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Trash2, Tag, Box, Loader2, Film } from 'lucide-react';
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
}

export default function AssetCard({ asset, onDelete, onUpdateTags, onClick }: AssetCardProps) {
  const { t } = useTranslation();
  const [hovering, setHovering] = useState(false);
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

  return (
    <div
      className="group relative rounded-modal border border-primary/8 bg-card/40 overflow-hidden transition-all hover:border-rose-500/20 hover:shadow-elevation-3 hover:shadow-rose-500/5 cursor-pointer"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={onClick}
    >
      {/* Thumbnail area */}
      <div className="relative aspect-square bg-background/60 flex items-center justify-center overflow-hidden">
        {isImage && dataUrl ? (
          <img
            src={dataUrl}
            alt={asset.fileName}
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

        {/* Hover overlay */}
        {hovering && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2 transition-opacity">
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
        )}
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
