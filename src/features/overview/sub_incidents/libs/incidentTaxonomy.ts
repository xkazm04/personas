import { AlertTriangle, Bell, Database, KeyRound, Stethoscope, ShieldAlert, Wrench, Zap } from 'lucide-react';
import { SEVERITY_COLORS } from '@/lib/utils/formatters';
import type { StatusKey } from '@/lib/design/statusTokens';
import type { Translations } from '@/i18n/en';

/**
 * Per-source visual + label mapping for the incidents inbox.
 *
 * Reuses `SEVERITY_COLORS` from `@/lib/utils/formatters` per the
 * `Overview/README.md` anti-pattern note (do NOT redefine).
 */

export type IncidentSourceTable =
  | 'fired_alerts'
  | 'tool_execution_audit_log'
  | 'credential_audit_log'
  | 'healing_audit_log'
  | 'provider_audit_log'
  | 'policy_events'
  | 'persona_healing_issues'
  | 'execution_error';

export const INCIDENT_SOURCE_ICONS: Record<IncidentSourceTable, typeof Bell> = {
  fired_alerts: Bell,
  tool_execution_audit_log: Wrench,
  credential_audit_log: KeyRound,
  healing_audit_log: Stethoscope,
  provider_audit_log: Zap,
  policy_events: ShieldAlert,
  persona_healing_issues: AlertTriangle,
  execution_error: AlertTriangle,
};

export function sourceTableIcon(source: string): typeof Bell {
  return INCIDENT_SOURCE_ICONS[source as IncidentSourceTable] ?? Database;
}

export function sourceTableLabel(t: Translations, source: string): string {
  switch (source as IncidentSourceTable) {
    case 'fired_alerts': return t.overview.incidents.source_alert;
    case 'tool_execution_audit_log': return t.overview.incidents.source_tool;
    case 'credential_audit_log': return t.overview.incidents.source_credential;
    case 'healing_audit_log': return t.overview.incidents.source_healing_log;
    case 'provider_audit_log': return t.overview.incidents.source_provider;
    case 'policy_events': return t.overview.incidents.source_policy;
    case 'persona_healing_issues': return t.overview.incidents.source_healing_issue;
    case 'execution_error': return t.overview.incidents.source_execution_error;
    default: return source;
  }
}

export function severityBadgeClass(severity: string): string {
  const config = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.medium!;
  return `${config.bg} ${config.text} ${config.border}`;
}

export function severityRank(severity: string): number {
  switch (severity) {
    case 'critical': return 4;
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 0;
  }
}

/**
 * Redundant, colour-independent severity cue for colour-blind users. Maps the
 * four-step severity onto the shared StatusShape vocabulary so each urgency
 * tier carries a distinct shape, not just a colour (critical/high → triangle,
 * medium → diamond, low → ring).
 */
export function severityShapeStatus(severity: string): StatusKey {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    default:
      return 'neutral';
  }
}

/**
 * Plain-language urgency framing for a severity token — what the user should do
 * about it, rather than the engineer-facing "critical / high / medium / low".
 */
export function severityUrgencyLabel(t: Translations, severity: string): string {
  switch (severity) {
    case 'critical': return t.overview.incidents.urgency_critical;
    case 'high': return t.overview.incidents.urgency_high;
    case 'medium': return t.overview.incidents.urgency_medium;
    default: return t.overview.incidents.urgency_low;
  }
}

/**
 * Plain-language "what to do" guidance for an incident, keyed off its source
 * stream. Surfaced as a callout in the detail modal so a non-technical user
 * knows the next step, not just what failed.
 */
export function incidentGuidance(t: Translations, sourceTable: string): string {
  switch (sourceTable) {
    case 'tool_execution_audit_log': return t.overview.incidents.guidance_tool;
    case 'credential_audit_log': return t.overview.incidents.guidance_credential;
    case 'healing_audit_log':
    case 'persona_healing_issues': return t.overview.incidents.guidance_healing;
    case 'provider_audit_log': return t.overview.incidents.guidance_provider;
    case 'policy_events': return t.overview.incidents.guidance_policy;
    case 'fired_alerts': return t.overview.incidents.guidance_alert;
    case 'execution_error': return t.overview.incidents.guidance_execution;
    default: return t.overview.incidents.guidance_default;
  }
}

export function statusLabel(t: Translations, status: string): string {
  switch (status) {
    case 'open': return t.overview.incidents.filter_status_open;
    case 'acknowledged': return t.overview.incidents.filter_status_acknowledged;
    case 'in_progress': return t.overview.incidents.filter_status_in_progress;
    case 'resolved': return t.overview.incidents.filter_status_resolved;
    case 'dismissed': return t.overview.incidents.filter_status_dismissed;
    default: return status;
  }
}

/** Active incidents open longer than this read as "stale" and get an age cue. */
export const STALE_THRESHOLD_MS = 3 * 24 * 3_600_000;

/**
 * True when an incident is still active and has been open past the stale
 * threshold — surfaced so long-waiting work doesn't rot unseen.
 */
export function isStaleIncident(incident: { status: string; createdAt: string }): boolean {
  if (incident.status === 'resolved' || incident.status === 'dismissed') return false;
  const ts = new Date(incident.createdAt).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts >= STALE_THRESHOLD_MS;
}

export function relativeTime(t: Translations, isoTimestamp: string): string {
  const ts = new Date(isoTimestamp).getTime();
  if (Number.isNaN(ts)) return isoTimestamp;
  const ageMs = Date.now() - ts;
  const ageMin = Math.floor(ageMs / 60_000);
  if (ageMin < 1) return t.overview.incidents.just_now;
  if (ageMin < 60) return `${ageMin}m`;
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h`;
  const ageDay = Math.floor(ageHr / 24);
  return `${ageDay}d`;
}
