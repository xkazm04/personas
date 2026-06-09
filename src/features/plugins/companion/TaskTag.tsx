import { AlertCircle, CheckCircle2, Hourglass, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { BackgroundJob } from '@/api/companion';

/**
 * Compact, read-only tag for one background Task (Athena async-UX phase 2).
 * Renders a status icon, the task's short title, an optional determinate
 * progress bar (progressCurrent/Total) or live progress note, and a status
 * label. Used by the ActivityTray (turn-independent) and for non-connector
 * tasks pinned in-chat. `connector_use` keeps its richer ConnectorCallCard
 * (result body + retry); this tag is the lightweight glance.
 *
 * Driven entirely by the unified `companion://job` event row — no new IPC.
 */
export function TaskTag({ job }: { job: BackgroundJob }) {
  const { t } = useTranslation();
  const failed = job.status === 'failed';
  const running = job.status === 'running';
  const { Icon, accent, tone } = visualFor(job.status, failed);

  const title = job.shortTitle?.trim() || kindLabel(job.kind);
  const statusLabel = statusFor(t, job.status);

  const cur = job.progressCurrent ?? null;
  const tot = job.progressTotal ?? null;
  const pct = cur != null && tot != null && tot > 0 ? Math.min(100, Math.round((cur / tot) * 100)) : null;
  // Live note while running: prefer the determinate "X/Y" when present,
  // else the free-text progress note the handler emitted.
  const note = running
    ? cur != null && tot != null
      ? `${cur}/${tot}`
      : job.progressText ?? null
    : null;

  return (
    <div
      className={`rounded-input border ${accent} px-2.5 py-1.5`}
      data-testid="companion-task-tag"
      data-job-id={job.id}
      data-job-kind={job.kind}
      data-job-status={job.status}
    >
      <div className="flex items-center gap-2 typo-caption">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${tone} ${running ? 'animate-spin' : ''}`} />
        <span className="flex-1 truncate text-foreground" title={title}>
          {title}
        </span>
        {note && <span className="text-foreground shrink-0 tabular-nums">{note}</span>}
        <span className={`shrink-0 ${tone}`}>{statusLabel}</span>
      </div>
      {pct != null && running && (
        <div className="mt-1 h-1 rounded-full bg-foreground/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-400/70 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'connector_use':
      return 'Calling a connector';
    case 'scan_codebase':
      return 'Scanning codebase';
    case 'memory_curation_run':
      return 'Curating memory';
    case 'in_turn_tool':
      return 'Running a tool';
    default:
      return kind.replace(/_/g, ' ');
  }
}

function statusFor(t: ReturnType<typeof useTranslation>['t'], status: string): string {
  switch (status) {
    case 'queued':
      return t.plugins.companion.task_status_queued;
    case 'running':
      return t.plugins.companion.task_status_running;
    case 'completed':
      return t.plugins.companion.task_status_done;
    case 'failed':
      return t.plugins.companion.task_status_failed;
    default:
      return status;
  }
}

function visualFor(status: string, failed: boolean): { Icon: typeof Hourglass; accent: string; tone: string } {
  if (status === 'queued') return { Icon: Hourglass, accent: 'border-foreground/10 bg-secondary/40', tone: 'text-foreground/55' };
  if (status === 'running') return { Icon: Loader2, accent: 'border-blue-500/30 bg-blue-500/[0.05]', tone: 'text-blue-300/90' };
  if (failed) return { Icon: AlertCircle, accent: 'border-rose-500/30 bg-rose-500/[0.06]', tone: 'text-rose-300/90' };
  return { Icon: CheckCircle2, accent: 'border-emerald-500/30 bg-emerald-500/[0.06]', tone: 'text-emerald-300/90' };
}
