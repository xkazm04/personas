import { useState, useCallback, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { kbIngestFiles } from '@/api/vault/database/vectorKb';
import { useTranslation } from '@/i18n/useTranslation';

interface IngestDropZoneProps {
  kbId: string;
  onIngestStarted: (jobId: string) => void;
  children: ReactNode;
}

export function IngestDropZone({ kbId, onIngestStarted, children }: IngestDropZoneProps) {
  const { t } = useTranslation();
  const sh = t.vault.shared;
  const [isDragOver, setIsDragOver] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Extract file paths (Tauri provides full paths on desktop)
    const paths: string[] = [];
    for (const file of files) {
      // In Tauri webview, file.path contains the full path
      const path = (file as unknown as { path?: string }).path;
      if (path) {
        paths.push(path);
      }
    }

    if (paths.length === 0) {
      setDropError('No valid file paths found. Try dropping individual files.');
      return;
    }

    setIngesting(true);
    setDropError(null);
    try {
      const jobId = await kbIngestFiles(kbId, paths);
      onIngestStarted(jobId);
    } catch (err) {
      setDropError(err instanceof Error ? err.message : String(err));
    } finally {
      setIngesting(false);
    }
  }, [kbId, onIngestStarted]);

  return (
    <div
      className="relative h-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      {children}

      {/* Drop error banner */}
      {dropError && (
        <div className="absolute top-2 left-2 right-2 z-10 p-2 rounded-card bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
          <span className="flex-1">{dropError}</span>
          <button onClick={() => setDropError(null)} className="text-red-400/60 hover:text-red-400 shrink-0">&times;</button>
        </div>
      )}

      {/* Drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-10 bg-violet-500/5 border-2 border-dashed border-violet-500/40 rounded-modal flex items-center justify-center backdrop-blur-[1px] pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-12 h-12 rounded-modal bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Upload className="w-6 h-6 text-violet-400" />
            </div>
            <p className="text-sm font-medium text-violet-300">{sh.drop_to_ingest}</p>
            <p className="text-xs text-muted-foreground/50">{sh.drop_supported}</p>
          </div>
        </div>
      )}

      {/* Ingesting overlay */}
      {ingesting && (
        <div className="absolute inset-0 z-10 bg-background/50 flex items-center justify-center backdrop-blur-[1px]">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
            <span className="text-sm text-foreground/70">{sh.starting_ingestion}</span>
          </div>
        </div>
      )}
    </div>
  );
}
