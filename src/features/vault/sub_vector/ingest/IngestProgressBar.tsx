import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import type { KbIngestProgress } from '@/api/vault/database/vectorKb';

interface IngestProgressBarProps {
  kbId: string;
  jobId: string;
  onComplete: () => void;
}

export function IngestProgressBar({ jobId, onComplete }: IngestProgressBarProps) {
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

  if (!progress) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground/60">
        <LoadingSpinner className="text-violet-400" />
        <span>Preparing ingestion...</span>
      </div>
    );
  }

  const pct = progress.documentsTotal > 0
    ? Math.round((progress.documentsDone / progress.documentsTotal) * 100)
    : 0;

  const hasError = progress.status === 'error' || !!progress.error;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        {hasError ? (
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
        ) : done ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        ) : (
          <LoadingSpinner className="text-violet-400 shrink-0" />
        )}

        <span className={`flex-1 truncate ${hasError ? 'text-red-400' : 'text-foreground/70'}`}>
          {hasError
            ? (progress.error || 'Ingestion failed')
            : done
            ? `Done! ${progress.chunksCreated} chunks from ${progress.documentsDone} files`
            : progress.currentFile
            ? `Processing: ${truncateFile(progress.currentFile)}`
            : 'Processing...'}
        </span>

        <span className="text-xs text-muted-foreground/50 shrink-0">
          {progress.documentsDone}/{progress.documentsTotal} files
        </span>
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
