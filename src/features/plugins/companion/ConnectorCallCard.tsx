import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Hourglass,
  Loader2,
  Wrench,
} from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import type { BackgroundJob } from '@/api/companion';

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

  const { connectorName, capability } = useMemo(
    () => parseParams(job.paramsJson),
    [job.paramsJson],
  );

  const isTerminal = job.status === 'completed' || job.status === 'failed';
  const failed = job.status === 'failed';

  const { Icon, accent } = iconFor(job.status, failed);

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
          <Chevron className="w-3.5 h-3.5 text-foreground/45 shrink-0" />
        ) : (
          <Wrench className="w-3.5 h-3.5 text-foreground/45 shrink-0" />
        )}
        <Icon
          className={`w-4 h-4 shrink-0 ${
            job.status === 'running' ? 'animate-spin' : ''
          }`}
        />
        <span className="flex-1 truncate">
          <span className="font-medium">{connectorName || '?'}</span>
          <span className="text-foreground/50"> · </span>
          <span className="text-foreground/70">{capability || '?'}</span>
        </span>
        <span className="typo-caption text-foreground/50 shrink-0">
          {statusLabel}
        </span>
      </button>
      {open && hasBody && (
        <div className="mt-2 pl-5 border-l border-foreground/10 typo-caption text-foreground/75">
          {failed && job.errorText ? (
            <div className="text-rose-300/90 whitespace-pre-wrap font-mono">
              {job.errorText}
            </div>
          ) : job.resultText ? (
            <MarkdownRenderer content={job.resultText} />
          ) : null}
        </div>
      )}
      {!isTerminal && (
        <div className="mt-1 pl-5 typo-caption text-foreground/45">
          {t.plugins.companion.connector_call_in_flight_hint}
        </div>
      )}
    </div>
  );
}

function parseParams(raw: string): {
  connectorName: string;
  capability: string;
} {
  try {
    const parsed = JSON.parse(raw) as {
      connector_name?: string;
      capability?: string;
    };
    return {
      connectorName: parsed.connector_name ?? '',
      capability: parsed.capability ?? '',
    };
  } catch {
    return { connectorName: '', capability: '' };
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
