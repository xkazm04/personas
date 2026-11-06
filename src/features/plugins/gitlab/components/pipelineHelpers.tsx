import { CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

export function statusColor(status: string): string {
  switch (status) {
    case 'success':
      return 'text-status-success';
    case 'failed':
      return 'text-status-error';
    case 'warning':
      return 'text-status-warning';
    case 'running':
    case 'pending':
      return 'text-status-warning';
    case 'canceled':
    case 'skipped':
      return 'text-ink-2';
    default:
      return 'text-ink-2';
  }
}

export function statusBg(status: string): string {
  // Console law: a surface keeps one hairline tile; the verdict is the status glyph and word, not a tint.
  return status === 'failed' ? 'bg-surface-1 border-status-error/40' : 'bg-surface-1 border-hair';
}

export function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="w-4 h-4 text-status-success" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-status-error" />;
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-status-warning" />;
    case 'running':
      return <LoadingSpinner className="text-status-warning" />;
    case 'pending':
      return <Clock className="w-4 h-4 text-status-warning" />;
    default:
      return <Clock className="w-4 h-4 text-ink-2" />;
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

/**
 * The persona segment the backend writes into `persona/<slug>/...` refs.
 * Mirrors `slugify_persona_name` in src-tauri/src/commands/infrastructure/gitlab.rs:
 * lowercase, EACH space to a dash, then drop everything that is not a letter,
 * digit or dash. The old `trim + /\s+/ -> '-'` kept punctuation and collapsed
 * runs, so `My Bot!` looked for `my-bot!` while its branch is `persona/my-bot/..`
 * and the agent row lost its pipeline chip.
 */
export function slugifyPersonaName(name: string): string {
  return Array.from(name.toLowerCase().replace(/ /g, '-'))
    .filter((c) => /[\p{Alphabetic}\p{N}-]/u.test(c))
    .join('');
}

export function pipelineForAgent<T extends { ref: string }>(
  pipelines: readonly T[],
  agentName: string,
): T | null {
  const wanted = slugifyPersonaName(agentName);
  if (!wanted.replace(/-/g, '')) return null;
  // Pipelines arrive newest-first from the API, so the first match is the latest.
  return pipelines.find((p) => agentSegment(p.ref) === wanted) ?? null;
}
