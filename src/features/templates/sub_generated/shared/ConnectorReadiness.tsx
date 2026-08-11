import { CheckCircle2, AlertCircle, XCircle, HelpCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import type { SetupKind } from '@/lib/bindings/SetupKind';
import type { ResolvedConnectorReadiness } from './useConnectorReadiness';

interface ConnectorReadinessProps {
  statuses: ResolvedConnectorReadiness[];
  compact?: boolean;
  /** Simple mode: show only a single checkmark or X with a label. */
  simplified?: boolean;
}

type OverallHealth = 'ready' | 'partial' | 'missing' | 'unknown';

/**
 * Collapse per-connector verdicts into one badge state.
 *
 * `unknown` wins over everything: while the authoritative resolver has not
 * answered for some connector, the honest badge is "checking", never a
 * confident "Ready" the run gate would contradict.
 */
function getOverallHealth(statuses: ResolvedConnectorReadiness[]): OverallHealth {
  if (statuses.length === 0) return 'ready';
  if (statuses.some((s) => s.health === 'unknown')) return 'unknown';
  if (statuses.every((s) => s.health === 'ready')) return 'ready';
  return statuses.some((s) => s.health === 'ready') ? 'partial' : 'missing';
}

const HEALTH_CONFIG = {
  ready: {
    Icon: CheckCircle2,
    color: 'text-status-success',
    bg: 'bg-status-success/10 border-status-success/20',
  },
  partial: {
    Icon: AlertCircle,
    color: 'text-status-warning',
    bg: 'bg-status-warning/10 border-status-warning/20',
  },
  missing: {
    Icon: XCircle,
    color: 'text-status-error',
    bg: 'bg-status-error/10 border-status-error/20',
  },
  unknown: {
    Icon: HelpCircle,
    color: 'text-status-neutral',
    bg: 'bg-secondary/40 border-primary/10',
  },
} as const;

function overallLabel(t: Translations, overall: OverallHealth): string {
  const c = t.templates.connector_readiness;
  switch (overall) {
    case 'ready':
      return c.ready;
    case 'partial':
      return c.partial;
    case 'missing':
      return c.setup_needed;
    default:
      return t.common.field_checking_availability;
  }
}

const STATUS_ICON = {
  ready: CheckCircle2,
  missing: AlertCircle,
  unknown: HelpCircle,
} as const;

const STATUS_COLOR = {
  ready: 'text-status-success',
  missing: 'text-status-warning',
  unknown: 'text-status-neutral',
} as const;

/**
 * Localized remediation for a `SetupKind`.
 *
 * The backend also ships an English detail line, but it is assembled in Rust
 * and can never be localized — so the language-agnostic kind token is what the
 * UI renders from. Mirrors `vault/components/SetupStatusBadge.tsx`.
 */
function remediationFor(t: Translations, kind: SetupKind | null): string {
  const k = t.vault.setup_kind;
  switch (kind) {
    case 'vault_credential':
      return k.vault_credential;
    case 'cli_login':
      return k.cli_login;
    case 'dev_project':
      return k.dev_project;
    case 'obsidian_vault':
      return k.obsidian_vault;
    case 'twin_profile':
      return k.twin_profile;
    case 'misconfigured':
      return k.misconfigured;
    default:
      return k.generic;
  }
}

/**
 * Compact dot indicator or detailed readiness badge.
 *
 * Renders verdicts from the authoritative Rust resolver only (see
 * `useConnectorReadiness`). There is deliberately no local fallback
 * computation — a second opinion on readiness is the bug, not the feature.
 */
export function ConnectorReadiness({ statuses, compact = true, simplified = false }: ConnectorReadinessProps) {
  const { t } = useTranslation();
  const overall = getOverallHealth(statuses);
  const config = HEALTH_CONFIG[overall];
  const StatusIcon = config.Icon;
  const label = overallLabel(t, overall);

  if (simplified) {
    return (
      <span className={`inline-flex items-center gap-1 ${config.color}`} title={label}>
        <StatusIcon className="w-3.5 h-3.5" />
        <span className="typo-caption font-medium">
          {overall === 'ready'
            ? t.templates.connector_readiness.ready
            : overall === 'partial'
              ? t.templates.connector_readiness.needs_setup
              : overall === 'missing'
                ? t.templates.connector_readiness.not_ready
                : label}
        </span>
      </span>
    );
  }

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 typo-body rounded-full border ${config.bg} ${config.color}`}
        title={label}
      >
        <StatusIcon className="w-3 h-3" />
        {label}
      </span>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <StatusIcon className={`w-4 h-4 ${config.color}`} />
        <span className="typo-body font-medium text-foreground/90">{label}</span>
      </div>
      {statuses.map((status) => {
        const Icon = STATUS_ICON[status.health];
        const color = STATUS_COLOR[status.health];
        return (
          <div key={status.connector_name} className="flex items-center gap-2 pl-6">
            <Icon className={`w-3.5 h-3.5 ${color}`} />
            <span className="typo-body text-foreground">{status.connector_name}</span>
            {status.health === 'missing' && (
              <span className="typo-body text-status-warning/60">
                {remediationFor(t, status.setup_kind)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
