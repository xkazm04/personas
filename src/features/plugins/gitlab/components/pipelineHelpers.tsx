import { CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

export function statusColor(status: string): string {
  switch (status) {
    case 'success':
      return 'text-emerald-400';
    case 'failed':
      return 'text-red-400';
    case 'warning':
      return 'text-amber-400';
    case 'running':
    case 'pending':
      return 'text-amber-400';
    case 'canceled':
    case 'skipped':
      return 'text-foreground';
    default:
      return 'text-foreground';
  }
}

export function statusBg(status: string): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-500/10 border-emerald-500/20';
    case 'failed':
      return 'bg-red-500/10 border-red-500/20';
    case 'warning':
      return 'bg-amber-500/10 border-amber-500/20';
    case 'running':
    case 'pending':
      return 'bg-amber-500/10 border-amber-500/20';
    default:
      return 'bg-secondary/30 border-primary/10';
  }
}

export function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-400" />;
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-amber-400" />;
    case 'running':
      return <LoadingSpinner className="text-amber-400" />;
    case 'pending':
      return <Clock className="w-4 h-4 text-amber-400" />;
    default:
      return <Clock className="w-4 h-4 text-foreground" />;
  }
}

import { formatDuration as _formatDuration } from '@/lib/utils/formatters';
export const formatDuration = (seconds: number | null) => _formatDuration(seconds, { unit: 's' });

import { formatRelativeTime } from '@/lib/utils/formatters';
export const formatRelative = (iso: string) => formatRelativeTime(iso);

/**
 * The pipeline that belongs to ONE deployed agent, or null.
 *
 * The agent list used to render `pipelines[0]` — the project's latest pipeline —
 * on every row, so a red chip on agent B was routinely agent A's build, sitting
 * right next to B's Redeploy and Undeploy buttons. A status without its entity
 * is not a weaker signal, it is a wrong one.
 *
 * Personas deploy onto `persona/<agent-name>/<env>` refs (see the GitLab branch
 * and tag types), so the ref's agent segment is the attribution. Anything that
 * cannot be attributed returns null and the row shows no chip: the Pipelines tab
 * is where project-wide status belongs.
 */
function agentSegment(ref: string): string {
  const parts = ref.toLowerCase().split('/').filter(Boolean);
  // `persona/<name>/<env>` → <name>; anything else → its first segment.
  if (parts[0] === 'persona' && parts.length > 1) return parts[1]!;
  return parts[0] ?? '';
}

export function pipelineForAgent<T extends { ref: string }>(
  pipelines: readonly T[],
  agentName: string,
): T | null {
  const wanted = agentName.trim().toLowerCase().replace(/\s+/g, '-');
  if (!wanted) return null;
  // Pipelines arrive newest-first from the API, so the first match is the latest.
  return pipelines.find((p) => agentSegment(p.ref) === wanted) ?? null;
}
