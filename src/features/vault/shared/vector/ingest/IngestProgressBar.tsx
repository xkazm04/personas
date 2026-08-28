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

/**
 * Payload of `kb:ingest_error`. NOT a `KbIngestProgress` — the four emit sites
 * in `src-tauri/src/commands/credentials/vector_kb.rs` (the ingest and reindex
 * error branches and both panic guards) construct a bare
 * `json!({ "jobId": …, "error": … })`, so there is no binding to import and this
 * shape is the invariant those four sites hold.
 */
interface KbIngestErrorEvent {
  jobId: string;
  error: string;
}

export function IngestProgressBar({ jobId, onComplete }: IngestProgressBarProps) {
  const { t, tx } = useTranslation();
  const sh = t.vault.shared;
  const [progress, setProgress] = useState<KbIngestProgress | null>(null);
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

  useEffect(() => {
    let unlisten1: (() => void) | undefined;
    let unlisten2: (() => void) | undefined;
    let unlisten3: (() => void) | undefined;
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
          // A FAILURE also arrives on the complete channel — `ingest_files`
          // reports "all N documents failed" and the partial "N of M failed"
          // there. Auto-dismissing those unmounted the bar 1.5s later, and the
          // bar was the only place that message existed: a red flash, then an
          // empty list and no explanation. Success still auto-dismisses;
          // a failure now waits to be read and dismissed.
          const failed = event.payload.status === 'error' || !!event.payload.error;
          if (!failed) {
            timeoutId = setTimeout(() => onCompleteRef.current(), 1500);
          }
        }
      });

      unlisten3 = await listen<KbIngestErrorEvent>(EventName.KB_INGEST_ERROR, (event) => {
        if (event.payload.jobId === jobId) {
          setFailure(event.payload.error || '');
          setDone(true);
        }
      });
    };

    void setup();
    return () => {
      unlisten1?.();
      unlisten2?.();
      unlisten3?.();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [jobId]);

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
