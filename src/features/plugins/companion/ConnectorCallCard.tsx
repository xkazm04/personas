import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Hourglass,
  Loader2,
  RefreshCcw,
  Wrench,
} from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import { companionEnqueueJob, type BackgroundJob } from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { capabilityLabel, connectorDisplayName } from './athenaLabels';
import { useCompanionStore } from './companionStore';

/**
 * Inline chat-card that surfaces the live state of a `connector_use`
 * background job: spinner during queued/running, ✓/✗ on completion. The
 * result body (markdown that the system episode also ingests) is shown
 * collapsed under the card; click the header to expand.
 *
 * Driven entirely by the `companion://job` event channel — the same row
 * the BackgroundJob list view consumes. No new IPC.
 */
export function ConnectorCallCard({ job }: { job: BackgroundJob }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [retryingState, setRetryingState] = useState<
    { phase: 'idle' } | { phase: 'firing' } | { phase: 'fired'; newId: string } | { phase: 'error'; message: string }
  >({ phase: 'idle' });
  // Subscribe to the retried-job's live state from the global jobs map.
  // When the retry has succeeded (`phase === 'fired'`), we render its
  // status (queued → running → completed / failed) directly below the
  // failed card so the user doesn't have to scroll the panel hunting
  // for the new card. Reads as undefined until the first
  // companion://job event arrives, which the existing CompanionPanel
  // listener already feeds into jobsById.
  const retriedJob = useCompanionStore((s) =>
    retryingState.phase === 'fired' ? s.jobsById[retryingState.newId] : undefined,
  );

  const { connectorName, capability, rawParams } = useMemo(
    () => parseParams(job.paramsJson),
    [job.paramsJson],
  );

  const isTerminal = job.status === 'completed' || job.status === 'failed';
  const failed = job.status === 'failed';

  const { Icon, accent } = iconFor(job.status, failed);

  const handleRetry = async () => {
    if (retryingState.phase !== 'idle') return;
    setRetryingState({ phase: 'firing' });
    try {
      // Re-enqueue with the same paramsJson the original job carried. The
      // backend assigns a fresh id; the new job will surface via the
      // existing companion://job listener as a pending card.
      const newId = await companionEnqueueJob('connector_use', rawParams);
      setRetryingState({ phase: 'fired', newId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setRetryingState({ phase: 'error', message });
      silentCatch('companion_retry_connector_call')(err);
    }
  };

  const statusLabel =
    job.status === 'queued'
      ? t.plugins.companion.connector_call_queued
      : job.status === 'running'
        ? t.plugins.companion.connector_call_running
        : job.status === 'completed'
          ? t.plugins.companion.connector_call_completed
          : job.status === 'failed'
            ? t.plugins.companion.connector_call_failed
            : job.status;

  // Auto-open on terminal status only if there's a body to show — keeps
  // in-flight cards visually quiet but reveals the result the moment
  // it's actionable.
  const Chevron = open ? ChevronDown : ChevronRight;
  const hasBody = Boolean(job.resultText) || Boolean(job.errorText);

  return (
    <div
      className={`rounded-card border ${accent} px-3 py-2`}
      data-testid="companion-connector-call-card"
      data-job-id={job.id}
      data-job-status={job.status}
    >
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        disabled={!hasBody}
        className="flex items-center gap-2 w-full text-left typo-body disabled:cursor-default"
      >
        {hasBody ? (
          <Chevron className="w-3.5 h-3.5 text-foreground shrink-0" />
        ) : (
          <Wrench className="w-3.5 h-3.5 text-foreground shrink-0" />
        )}
        <Icon
          className={`w-4 h-4 shrink-0 ${
            job.status === 'running' ? 'animate-spin' : ''
          }`}
        />
        <span className="flex-1 truncate">
          <span className="font-medium">
            {connectorName ? connectorDisplayName(t, connectorName) : '?'}
          </span>
          <span className="text-foreground"> · </span>
          <span className="text-foreground">
            {capability ? capabilityLabel(t, capability) : '?'}
          </span>
        </span>
        <span className="typo-caption text-foreground shrink-0">
          {statusLabel}
        </span>
      </button>
      {open && hasBody && (
        <div className="mt-2 pl-5 border-l border-foreground/10 typo-caption text-foreground">
          {failed && job.errorText ? (
            <div className="text-rose-300/90 whitespace-pre-wrap font-mono">
              {job.errorText}
            </div>
          ) : job.resultText ? (
            <MarkdownRenderer
              content={job.resultText}
              className="athena-chat-md"
              codeBlockActions
            />
          ) : null}
        </div>
      )}
      {failed && (
        <div className="mt-2 pl-5 flex items-center gap-2 typo-caption">
          {retryingState.phase === 'idle' && (
            <button
              type="button"
              onClick={handleRetry}
              className="inline-flex items-center gap-1 rounded-interactive border border-foreground/15 bg-foreground/[0.04] hover:bg-foreground/[0.08] px-2 py-0.5 text-foreground transition-colors focus-ring"
              data-testid="companion-connector-retry"
            >
              <RefreshCcw className="w-3 h-3" />
              <span>{t.plugins.companion.connector_call_retry}</span>
            </button>
          )}
          {retryingState.phase === 'firing' && (
            <span className="inline-flex items-center gap-1 text-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t.plugins.companion.connector_call_retrying}
            </span>
          )}
          {retryingState.phase === 'fired' && (
            <span
              className="inline-flex items-center gap-1 text-emerald-300/90"
              data-testid="companion-connector-retried"
            >
              <CheckCircle2 className="w-3 h-3" />
              {t.plugins.companion.connector_call_retried.replace(
                '{id}',
                retryingState.newId.slice(0, 8),
              )}
            </span>
          )}
          {retryingState.phase === 'error' && (
            <span className="inline-flex items-center gap-1 text-rose-300/90">
              <AlertCircle className="w-3 h-3" />
              {t.plugins.companion.connector_call_retry_failed.replace(
                '{message}',
                retryingState.message,
              )}
            </span>
          )}
        </div>
      )}
      {retryingState.phase === 'fired' && (
        <RetriedJobStatus job={retriedJob} />
      )}
      {!isTerminal && (
        <div className="mt-1 pl-5 typo-caption text-foreground">
          {/*
            While running, prefer the live progress note the handler emits
            ("Calling Sentry…") over the static hint, so the card reports
            what's happening instead of a generic "working" line.
          */}
          {job.progressText ?? t.plugins.companion.connector_call_in_flight_hint}
        </div>
      )}
    </div>
  );
}

function parseParams(raw: string): {
  connectorName: string;
  capability: string;
  rawParams: Record<string, unknown>;
} {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> & {
      connector_name?: string;
      capability?: string;
    };
    return {
      connectorName: parsed.connector_name ?? '',
      capability: parsed.capability ?? '',
      rawParams: parsed,
    };
  } catch {
    return { connectorName: '', capability: '', rawParams: {} };
  }
}

function iconFor(
  status: BackgroundJob['status'],
  failed: boolean,
): { Icon: typeof Hourglass; accent: string } {
  if (status === 'queued') {
    return {
      Icon: Hourglass,
      accent: 'border-foreground/10 bg-secondary/40',
    };
  }
  if (status === 'running') {
    return {
      Icon: Loader2,
      accent: 'border-blue-500/30 bg-blue-500/[0.05]',
    };
  }
  if (failed) {
    return {
      Icon: AlertCircle,
      accent: 'border-rose-500/30 bg-rose-500/[0.06]',
    };
  }
  return {
    Icon: CheckCircle2,
    accent: 'border-emerald-500/30 bg-emerald-500/[0.06]',
  };
}

/**
 * Compact status row rendered below a failed ConnectorCallCard once its
 * Retry button has fired. Subscribes to the retried job's live state via
 * the global jobs map (jobsById). Three visible phases:
 *   - undefined → "Waiting for status…" (the new job's first
 *     companion://job event hasn't reached the frontend yet)
 *   - queued/running → spinner + status label
 *   - terminal → ✓ / ✗ icon + result preview / error message
 *
 * Result / error body is line-clamped to keep the inline shape tight;
 * the original failed card stays the anchor and the user can scroll to
 * the unclamped pending-card listing if they want the full body.
 */
function RetriedJobStatus({ job }: { job: BackgroundJob | undefined }) {
  const { t } = useTranslation();
  if (!job) {
    return (
      <div
        className="mt-1 pl-5 typo-caption text-foreground inline-flex items-center gap-1"
        data-testid="companion-retried-status-waiting"
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>{t.plugins.companion.connector_call_retry_waiting}</span>
      </div>
    );
  }
  const newFailed = job.status === 'failed';
  const { Icon } = iconFor(job.status, newFailed);
  const tone =
    job.status === 'completed'
      ? 'text-emerald-300/90'
      : newFailed
        ? 'text-rose-300/90'
        : 'text-foreground';
  return (
    <div
      className="mt-1 pl-5 typo-caption flex items-baseline gap-1"
      data-testid="companion-retried-status"
      data-retried-status={job.status}
    >
      <Icon
        className={`w-3 h-3 self-center ${tone} ${
          job.status === 'running' ? 'animate-spin' : ''
        }`}
      />
      <code className="font-mono text-foreground">{job.id.slice(0, 8)}</code>
      <span className="text-foreground">·</span>
      <span className={`${tone} truncate`}>
        {job.status === 'completed' && job.resultText
          ? job.resultText.split('\n')[0]?.slice(0, 80) ?? job.status
          : newFailed && job.errorText
            ? job.errorText.split('\n')[0]?.slice(0, 80) ?? job.status
            : job.status}
      </span>
    </div>
  );
}
