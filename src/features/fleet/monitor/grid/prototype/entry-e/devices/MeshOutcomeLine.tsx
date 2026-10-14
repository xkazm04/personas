// What a row last asked another device to do, said ON the row: "sending",
// "queued until it wakes", or the device's refusal in its own words (a known
// reason token in ours). Toasts render under portal modals; a row does not.
//
// The stored outcome names its job; while that job is in `remoteJobs` its
// LIVE status wins, so a verb queued for a sleeping device reads as accepted
// or refused the moment the device wakes and answers.

import { memo } from 'react';
import { CircleAlert, Clock, Send } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { outcomeOfJob, type MeshOutcome } from '@/stores/slices/network/meshSlice';
import { deviceName } from './meshRead';

/** The row's outcome, with the job's live status applied. `null` = nothing to say. */
export function useMeshOutcome(key: string): MeshOutcome | null {
  const stored = useSystemStore((s) => s.meshOutcomes[key] ?? null);
  const job = useSystemStore((s) => (stored?.jobId ? s.remoteJobs.find((j) => j.id === stored.jobId) ?? null : null));
  if (!stored) return null;
  return job ? outcomeOfJob(job) : stored;
}

/** A peer's refusal token in words; anything else is shown as the peer wrote it. */
export function useRefusalText() {
  const m = useTranslation().t.monitor;
  return (reason: string | null): string => {
    if (!reason) return m.mesh_refusal_unknown;
    if (reason === 'project_off') return m.mesh_refusal_project_off;
    return reason;
  };
}

export const MeshOutcomeLine = memo(function MeshOutcomeLine({
  outcomeKey, device: name, pendingText, className = '',
}: {
  outcomeKey: string;
  /** The device's name; resolved from the mesh by the outcome's peer when absent. */
  device?: string;
  /** What "pending" is called on this row; `{device}` is filled in ("Moving to X"). */
  pendingText?: string;
  className?: string;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const outcome = useMeshOutcome(outcomeKey);
  const refusal = useRefusalText();
  const known = useSystemStore((s) => {
    const d = outcome ? s.meshDevices.find((x) => x.peerId === outcome.peerId) : null;
    return d ? deviceName(d) : null;
  });
  if (!outcome || outcome.state === 'accepted') return null;
  const device = name ?? known ?? outcome.peerId.slice(0, 8);

  const [Icon, tone, text] = outcome.state === 'pending'
    ? [Send, 'text-foreground', tx(pendingText ?? m.mesh_outcome_pending, { device })]
    : outcome.state === 'queued'
      ? [Clock, 'text-status-info', m.mesh_outcome_queued]
      : [CircleAlert, 'text-status-error', tx(m.mesh_outcome_refused, { device, reason: refusal(outcome.reason) })];

  return (
    <span
      role={outcome.state === 'refused' ? 'alert' : 'status'}
      className={`flex min-w-0 items-start gap-1.5 typo-caption ${tone} ${className}`}
      data-testid={`mesh-outcome-${outcome.state}`}
    >
      <Icon className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 line-clamp-2">{text}</span>
    </span>
  );
});
