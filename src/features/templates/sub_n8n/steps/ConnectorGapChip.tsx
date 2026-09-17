/**
 * The readiness of one detected connector against the vault.
 *
 * `analyzeCredentialGaps` has ranked connectors ready / ambiguous / missing
 * since it was written and had ZERO UI consumers, so the analyze step could
 * only toggle connector names and the wizard footer could only say how many
 * were missing - never WHICH. Users were dropped into Process with Matrix with
 * silent credential holes.
 */
import { CheckCircle2, HelpCircle, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { CredentialGapEntry } from '../edit/credentialGapAnalysis';

const TONE = {
  ready: 'text-emerald-400',
  ambiguous: 'text-amber-400',
  missing: 'text-red-400',
} as const;

const ICON = {
  ready: CheckCircle2,
  ambiguous: HelpCircle,
  missing: AlertCircle,
} as const;

export function ConnectorGapChip({ entry }: { entry: CredentialGapEntry }) {
  const { t, tx } = useTranslation();
  const n8n = t.templates.n8n;
  const Icon = ICON[entry.status];

  const label =
    entry.status === 'ready'
      ? n8n.connector_status_ready
      : entry.status === 'ambiguous'
        ? tx(n8n.connector_status_ambiguous, { count: entry.ambiguousCandidates.length })
        : n8n.connector_status_missing;

  const detail =
    entry.status === 'ambiguous'
      ? entry.ambiguousCandidates.map((c) => c.name).join(', ')
      : entry.status === 'ready'
        ? (entry.matchedCredential?.name ?? '')
        : '';

  return (
    <span
      className={`inline-flex items-center gap-1 typo-caption ${TONE[entry.status]}`}
      data-testid={`connector-gap-${entry.connector.name}`}
      data-status={entry.status}
    >
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      {label}
      {/* The candidate names are the whole point of the ambiguous arm: the
          user has to pick one and cannot without knowing what they are. They
          are rendered, not hidden behind a native title tooltip. */}
      {detail ? <span className="text-foreground truncate max-w-[18ch]">{detail}</span> : null}
    </span>
  );
}
