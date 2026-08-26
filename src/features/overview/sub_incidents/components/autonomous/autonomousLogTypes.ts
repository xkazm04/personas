import type { AuditIncident } from '@/lib/bindings/AuditIncident';

export interface AutonomousLogProps {
  incidents: AuditIncident[];
  loading: boolean;
  onOpenIncident: (incident: AuditIncident) => void;
}

/**
 * How long an incident sat between being raised and the system resuming it,
 * as a short human label. Null when it was never resumed (or the stamps are
 * unusable) — the caller renders nothing rather than a fabricated zero.
 */
export function resumeLatencyLabel(incident: AuditIncident): string | null {
  if (!incident.continuedAt) return null;
  const ms = Date.parse(incident.continuedAt) - Date.parse(incident.createdAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}
