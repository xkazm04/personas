import { Key, Bot, Zap } from 'lucide-react';
import type { GraphNodeKind } from './credentialGraph';
import type { Translations } from '@/i18n/en';

export const KIND_ICONS: Record<GraphNodeKind, typeof Key> = {
  credential: Key,
  agent: Bot,
  event: Zap,
};

/** Static KIND_LABELS -- use getKindLabels(t) for translated labels in components. */
export const KIND_LABELS: Record<GraphNodeKind, string> = {
  credential: 'Credentials',
  agent: 'Agents',
  event: 'Events',
};

/** Returns translated kind labels from the translation tree. */
export function getKindLabels(t: Translations): Record<GraphNodeKind, string> {
  const dep = t.vault.dependencies;
  return {
    credential: dep.kind_credentials,
    agent: dep.kind_agents,
    event: dep.kind_events,
  };
}

export const SEVERITY_STYLES = {
  low: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', label: 'Low Risk' },
  medium: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', label: 'Medium Risk' },
  high: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', label: 'High Risk' },
  critical: { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-400', border: 'border-fuchsia-500/20', label: 'Critical' },
} as const;

/** Returns severity styles with translated labels. */
export function getSeverityStyles(t: Translations) {
  const dep = t.vault.dependencies;
  return {
    low: { ...SEVERITY_STYLES.low, label: dep.severity_low },
    medium: { ...SEVERITY_STYLES.medium, label: dep.severity_medium },
    high: { ...SEVERITY_STYLES.high, label: dep.severity_high },
    critical: { ...SEVERITY_STYLES.critical, label: dep.severity_critical },
  } as const;
}
