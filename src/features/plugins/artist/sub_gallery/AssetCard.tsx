import { useState } from 'react';
import { Trash2, Tag, Box, Loader2 } from 'lucide-react';
import type { ArtistAsset } from '@/api/artist';
import { useLocalImage } from '../hooks/useLocalImage';

interface AssetCardProps {
  asset: ArtistAsset;
  onDelete: (id: string) => void;
  onUpdateTags: (id: string, tags: string) => void;
  onClick?: () => void;
}

export default function AssetCard({ asset, onDelete, onUpdateTags, onClick }: AssetCardProps) {
  const [hovering, setHovering] = useState(false);
  const isImage = asset.assetType === '2d';
  const sizeStr = formatFileSize(asset.fileSize);
  const ext = asset.fileName.split('.').pop()?.toUpperCase() ?? '';
  const dataUrl = useLocalImage(isImage ? asset.filePath : null);

  return (
    <div
      className="group relative rounded-xl border border-primary/8 bg-card/40 overflow-hidden transition-all hover:border-rose-500/20 hover:shadow-lg hover:shadow-rose-500/5 cursor-pointer"
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
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Box className="w-10 h-10 text-rose-400" />
            <span className="text-[10px] font-mono text-muted-foreground uppercase">{ext}</span>
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
              className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const tags = prompt('Tags (comma-separated):', asset.tags ?? '');
                if (tags !== null) onUpdateTags(asset.id, tags);
              }}
              className="p-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
              title="Edit Tags"
            >
              <Tag className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-3 py-2 space-y-0.5">
        <p className="text-xs text-foreground truncate font-medium">{asset.fileName}</p>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{ext}</span>
          <span>&middot;</span>
          <span>{sizeStr}</span>
        </div>
        {asset.tags && (
          <div className="flex flex-wrap gap-1 mt-1">
            {asset.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => (
              <span
                key={t}
                className="px-1.5 py-0.5 rounded text-[9px] bg-rose-500/10 text-rose-400"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
