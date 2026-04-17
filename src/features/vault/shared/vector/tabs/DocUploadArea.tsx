import { RefreshCw, Type, FileSearch, FolderOpen } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface DocToolbarProps {
  documentCount: number;
  onRefresh: () => void;
  onShowTextModal: () => void;
  onBrowseFiles: () => void;
  onShowDirPicker: () => void;
}

export function DocToolbar({
  documentCount,
  onRefresh,
  onShowTextModal,
  onBrowseFiles,
  onShowDirPicker,
}: DocToolbarProps) {
  const { t } = useTranslation();
  const sh = t.vault.shared;

  return (
    <div className="flex items-center gap-2 px-6 py-3 border-b border-primary/10 shrink-0">
      <h3 className="text-sm font-medium text-foreground/80 flex-1">
        {documentCount} document{documentCount !== 1 ? 's' : ''}
      </h3>
      <button
        onClick={onRefresh}
        className="p-1.5 rounded-card hover:bg-secondary/50 transition-colors text-muted-foreground/60 hover:text-foreground/80"
        title={t.vault.databases.refresh}
      >
        <RefreshCw className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onShowTextModal}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-card bg-secondary/40 hover:bg-secondary/60 text-foreground/80 transition-colors"
      >
        <Type className="w-3 h-3" />
        {sh.paste_text}
      </button>
      <button
        onClick={onBrowseFiles}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-card bg-secondary/40 hover:bg-secondary/60 text-foreground/80 transition-colors"
      >
        <FileSearch className="w-3 h-3" />
        {sh.browse_files}
      </button>
      <button
        onClick={onShowDirPicker}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-card bg-secondary/40 hover:bg-secondary/60 text-foreground/80 transition-colors"
      >
        <FolderOpen className="w-3 h-3" />
        {sh.directory}
      </button>
    </div>
  );
}
