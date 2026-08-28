import { useState, useCallback, useEffect, useRef } from 'react';
import { CheckCircle2, AlertCircle, Loader } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useTypedTauriEvent } from '@/hooks/useTauriEvent';
import { EventName } from '@/lib/eventRegistry';
import type { KbIngestProgressPayload } from '@/lib/eventRegistry';

interface IngestProgressBarProps {
  kbId: string;
  jobId: string;
  onComplete: () => void;
}


export function IngestProgressBar({ jobId, onComplete }: IngestProgressBarProps) {
  const { t, tx } = useTranslation();
  const sh = t.vault.shared;
  const [progress, setProgress] = useState<KbIngestProgressPayload | null>(null);
  const [done, setDone] = useState(false);
  // Set only by `kb:ingest_error`. Until this bar subscribed to that channel, a
  // job that died at the TOP level — `update_kb_counters` failing before the
  // terminal emit, a reindex failing on `embed_batch`, or the task panicking —
  // reported on a channel with no listener anywhere in the app. `onComplete`
  // never fired, so the bar sat on "Preparing ingestion…" forever and the
  // document list was never refreshed. Closing the modal was the only escape.
  const [failure, setFailure] = useState<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Through `useTypedTauriEvent`, not a bare `listen()` in an effect. The hand-
  // rolled form assigned its unlisten fn INSIDE an async callback, so a cleanup
  // that ran before `listen()` resolved — closing the modal right after starting
  // a job, or StrictMode's double-invoke — no-op'd, and the subscription then
  // registered and lived for the rest of the process, one leak per open/close.
  // The hook owns that race, the teardown and the payload typing.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  useTypedTauriEvent(
    EventName.KB_INGEST_PROGRESS,
    useCallback(
      (payload: KbIngestProgressPayload) => {
        if (payload.jobId === jobId) setProgress(payload);
      },
      [jobId],
    ),
  );

  useTypedTauriEvent(
    EventName.KB_INGEST_COMPLETE,
    useCallback(
      (payload: KbIngestProgressPayload) => {
        if (payload.jobId !== jobId) return;
        setProgress(payload);
        setDone(true);
        // A FAILURE also arrives on the complete channel — `ingest_files`
        // reports "all N documents failed" and the partial "N of M failed"
        // there. Auto-dismissing those unmounted the bar 1.5s later, and the
        // bar was the only place that message existed: a red flash, then an
        // empty list and no explanation. Success still auto-dismisses;
        // a failure now waits to be read and dismissed.
        if (payload.status === 'error' || payload.error) return;
        timeoutRef.current = setTimeout(() => onCompleteRef.current(), 1500);
      },
      [jobId],
    ),
  );

  useTypedTauriEvent(
    EventName.KB_INGEST_ERROR,
    useCallback(
      (payload: { jobId: string; error: string }) => {
        if (payload.jobId !== jobId) return;
        setFailure(payload.error || '');
        setDone(true);
      },
      [jobId],
    ),
  );

  const pct = progress && progress.documentsTotal > 0
    ? Math.round((progress.documentsDone / progress.documentsTotal) * 100)
    : 0;

  const hasError =
    failure !== null || (!!progress && (progress.status === 'error' || !!progress.error));
  const errorText = failure || progress?.error || null;

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
          {hasError
            ? (errorText || sh.ingestion_failed)
            : !progress
            ? sh.preparing_ingestion
            : done
            ? tx(sh.ingestion_done, { chunks: progress.chunksCreated, docs: progress.documentsDone })
            : progress.currentFile
            ? tx(sh.processing_file, { file: truncateFile(progress.currentFile) })
            : sh.processing}
        </span>

        {progress && !hasError && (
          <span className="typo-caption text-foreground shrink-0">
            {tx(sh.file_progress, { done: progress.documentsDone, total: progress.documentsTotal })}
          </span>
        )}

        {/* The bar no longer clears itself on failure, so it needs a way out. */}
        {hasError && (
          <button
            type="button"
            onClick={() => onCompleteRef.current()}
            className="typo-caption shrink-0 px-2 py-0.5 rounded-card border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            {t.common.dismiss}
          </button>
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
