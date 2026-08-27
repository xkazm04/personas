import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, AlertCircle, Loader } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import type { KbIngestProgress } from '@/api/vault/database/vectorKb';

interface IngestProgressBarProps {
  kbId: string;
  jobId: string;
  onComplete: () => void;
}

export function IngestProgressBar({ jobId, onComplete }: IngestProgressBarProps) {
  const { t, tx } = useTranslation();
  const sh = t.vault.shared;
  const [progress, setProgress] = useState<KbIngestProgress | null>(null);
  const [done, setDone] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let unlisten1: (() => void) | undefined;
    let unlisten2: (() => void) | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const setup = async () => {
      unlisten1 = await listen<KbIngestProgress>(EventName.KB_INGEST_PROGRESS, (event) => {
        if (event.payload.jobId === jobId) {
          setProgress(event.payload);
        }
      });

      unlisten2 = await listen<KbIngestProgress>(EventName.KB_INGEST_COMPLETE, (event) => {
        if (event.payload.jobId === jobId) {
          setProgress(event.payload);
          setDone(true);
          // Delay onComplete slightly so the user sees the final state
          timeoutId = setTimeout(() => onCompleteRef.current(), 1500);
        }
      });
    };

    void setup();
    return () => {
      unlisten1?.();
      unlisten2?.();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [jobId]);

  const pct = progress && progress.documentsTotal > 0
    ? Math.round((progress.documentsDone / progress.documentsTotal) * 100)
    : 0;

  const hasError = !!progress && (progress.status === 'error' || !!progress.error);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 typo-body">
        {hasError ? (
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" aria-hidden />
        ) : done ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden />
        ) : (
          <Loader className="w-4 h-4 text-violet-400/70 shrink-0" aria-hidden />
        )}

        <span
          role="status"
          aria-live="polite"
          className={`flex-1 truncate ${hasError ? 'text-red-400' : 'text-foreground'}`}
        >
          {!progress
            ? sh.preparing_ingestion
            : hasError
            ? (progress.error || sh.ingestion_failed)
            : done
            ? tx(sh.ingestion_done, { chunks: progress.chunksCreated, docs: progress.documentsDone })
            : progress.currentFile
            ? tx(sh.processing_file, { file: truncateFile(progress.currentFile) })
            : sh.processing}
        </span>

        {progress && (
          <span className="typo-caption text-foreground shrink-0">
            {tx(sh.file_progress, { done: progress.documentsDone, total: progress.documentsTotal })}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            hasError ? 'bg-red-500/60' : done ? 'bg-emerald-500/60' : 'bg-violet-500/60'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function truncateFile(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : path;
}
