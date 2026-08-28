import { useState, useCallback, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { kbIngestFiles } from '@/api/vault/database/vectorKb';
import { useTranslation } from '@/i18n/useTranslation';
import { DropZoneGlow } from '@/features/shared/components/feedback/DropZoneGlow';
import { KbErrorNotice } from '../KbErrorNotice';

interface IngestDropZoneProps {
  kbId: string;
  onIngestStarted: (jobId: string) => void;
  /**
   * True while an ingestion already owns the parent's single job slot. A drop
   * accepted now would overwrite that job's id, orphaning its progress and its
   * completion event — so the zone stops inviting the drop and refuses it.
   */
  disabled?: boolean;
  children: ReactNode;
}

export function IngestDropZone({ kbId, onIngestStarted, disabled = false, children }: IngestDropZoneProps) {
  const { t } = useTranslation();
  const sh = t.vault.shared;
  const [isDragOver, setIsDragOver] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  // `localized` distinguishes a message this component wrote (already in the
  // user's language) from a raw backend string the error registry must resolve.
  const [dropError, setDropError] = useState<{ text: string; localized: boolean } | null>(null);

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

    // Say why nothing happened rather than swallowing the drop.
    if (disabled) {
      setDropError({ text: sh.ingest_in_progress, localized: true });
      return;
    }

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
      setDropError({ text: sh.drop_no_paths, localized: true });
      return;
    }

    setIngesting(true);
    setDropError(null);
    try {
      const jobId = await kbIngestFiles(kbId, paths);
      onIngestStarted(jobId);
    } catch (err) {
      setDropError({ text: err instanceof Error ? err.message : String(err), localized: false });
    } finally {
      setIngesting(false);
    }
  }, [kbId, onIngestStarted, disabled, sh]);

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
        <KbErrorNotice
          raw={dropError.text}
          localized={dropError.localized}
          compact
          onDismiss={() => setDropError(null)}
          className="absolute top-2 left-2 right-2 z-10"
        />
      )}

      {/* Drop overlay */}
      <DropZoneGlow active={isDragOver} radius={12} />
      {isDragOver && (
        <div className="absolute inset-0 z-10 bg-violet-500/5 rounded-modal flex items-center justify-center backdrop-blur-[1px] pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-12 h-12 rounded-modal bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Upload className="w-6 h-6 text-violet-400" />
            </div>
            <p className="typo-body font-medium text-violet-300">{disabled ? sh.ingest_in_progress : sh.drop_to_ingest}</p>
            {!disabled && <p className="typo-caption text-foreground">{sh.drop_supported}</p>}
          </div>
        </div>
      )}

      {/*
        Ingesting overlay. This one KEEPS its ring: a drop is an ACTION, and
        the golden path requires a real spinner for an action in flight — but
        the "control" here is the whole zone, so there is no Button to hang it
        on. It paints violet-500, not the banned border-white/*.
      */}
      {ingesting && (
        <div className="absolute inset-0 z-10 bg-background/50 flex items-center justify-center backdrop-blur-[1px]">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
            <span className="typo-body text-foreground">{sh.starting_ingestion}</span>
          </div>
        </div>
      )}
    </div>
  );
}
