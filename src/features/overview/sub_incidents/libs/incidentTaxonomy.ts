import { AlertTriangle, Bell, Database, KeyRound, Stethoscope, ShieldAlert, Wrench, Zap } from 'lucide-react';
import { SEVERITY_COLORS } from '@/lib/utils/formatters';
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
  | 'persona_healing_issues';

export const INCIDENT_SOURCE_ICONS: Record<IncidentSourceTable, typeof Bell> = {
  fired_alerts: Bell,
  tool_execution_audit_log: Wrench,
  credential_audit_log: KeyRound,
  healing_audit_log: Stethoscope,
  provider_audit_log: Zap,
  policy_events: ShieldAlert,
  persona_healing_issues: AlertTriangle,
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

export function statusLabel(t: Translations, status: string): string {
  switch (status) {
    case 'open': return t.overview.incidents.filter_status_open;
    case 'acknowledged': return t.overview.incidents.filter_status_acknowledged;
    case 'resolved': return t.overview.incidents.filter_status_resolved;
    case 'dismissed': return t.overview.incidents.filter_status_dismissed;
    default: return status;
  }
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
