import { CheckCircle2, XCircle, Ban, HelpCircle } from 'lucide-react';
import { LiveStatusDot } from '@/features/shared/components/display/LiveStatusDot';

/**
 * The monitor's own closed status vocabulary for a cloud execution row or a
 * trigger firing. The orchestrator's raw strings are mapped here, in ONE
 * table, and an unmapped string lands in a rendered `unknown` — never in the
 * "in flight" glyph. Until 2026-09-07 the fallthrough branch was the in-flight
 * dot, so `error` (which the cloud runner itself treats as terminal,
 * `src-tauri/src/cloud/runner.rs`) and any status a newer orchestrator adds
 * rendered as a run still going. The registry technique is
 * provider-capability-honesty: one canonical set, explicit catch-all to
 * `unknown`, raw string preserved beside it.
 */
export type ExecutionStatusClass = 'completed' | 'failed' | 'cancelled' | 'in_flight' | 'unknown';

const STATUS_CLASS: Readonly<Record<string, ExecutionStatusClass>> = {
  completed: 'completed',
  failed: 'failed',
  error: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  pending: 'in_flight',
  queued: 'in_flight',
  running: 'in_flight',
};

export function classifyExecutionStatus(status: string | null | undefined): ExecutionStatusClass {
  if (!status) return 'unknown';
  return STATUS_CLASS[status] ?? 'unknown';
}

export function statusIcon(status: string) {
  switch (classifyExecutionStatus(status)) {
    case 'completed': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case 'failed': return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    case 'cancelled': return <Ban className="w-3.5 h-3.5 text-amber-400" />;
    // `LoadingSpinner` renders null, so a queued/running row had NO status
    // glyph at all. The shared liveness dot is the vocabulary for "in flight".
    case 'in_flight': return <LiveStatusDot tone="syncing" size="sm" className="mx-0.5" />;
    // Honest unknown: styled as its own thing, not as failure (false alarm)
    // and not as pending (false calm). The raw string rides along for
    // assistive tech; the expanded row prints it in full.
    default: return <HelpCircle className="w-3.5 h-3.5 text-foreground" role="img" aria-label={status} data-status-class="unknown" />;
  }
}

/**
 * Does this execution belong to the top-error cluster the operator clicked?
 *
 * The stats endpoint groups failures by message and ships each cluster's text
 * back already normalised (and, for a long message, truncated), so an exact
 * equality test would match almost nothing. The cluster and the row therefore
 * match when either string contains the other, case-insensitively - the row is
 * in the cluster whether the panel holds the longer text or the summary does.
 * Only terminally-failed rows are ever in a cluster.
 */
export function matchesErrorCluster(
  exec: { status: string; errorMessage: string | null },
  cluster: string,
): boolean {
  if (classifyExecutionStatus(exec.status) !== 'failed') return false;
  const message = (exec.errorMessage ?? '').trim().toLowerCase();
  const needle = cluster.trim().toLowerCase();
  if (!message || !needle) return false;
  return message.includes(needle) || needle.includes(message);
}

// `timeAgo` hoisted to `@/lib/utils/formatters` (Wave 5 consolidation).
// Note: this file previously used `formatRelativeTime(iso)` with the bare '-'
// fallback — drifted from the other 3 deployment helpers that fell back to
// 'Never'. Fixed to use the canonical 'Never'-fallback variant.
export { formatDuration, formatCost, timeAgo } from '@/lib/utils/formatters';
