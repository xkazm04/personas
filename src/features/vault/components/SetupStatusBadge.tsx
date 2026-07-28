import { AlertTriangle, Settings, CheckCircle2 } from 'lucide-react';
import type { PersonaSetup } from '@/lib/bindings/PersonaSetup';
import type { SetupKind } from '@/lib/bindings/SetupKind';
import { debtText } from '@/i18n/DebtText';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';


type Status = 'ready' | 'needs_credentials' | 'misconfigured';

interface Props {
  status: string | null | undefined;
  /**
   * JSON-encoded `PersonaSetup` from `persona.setup_detail`. When present,
   * the badge tooltip names exactly which connectors need setup and where
   * to fix each one — instead of the old static (and often wrong) "add
   * credentials in Settings → Vault" line.
   */
  setupDetail?: string | null;
  variant?: 'compact' | 'inline';
  className?: string;
}

function parseSetup(raw: string | null | undefined): PersonaSetup | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersonaSetup;
  } catch {
    return null;
  }
}

/**
 * Translate a `SetupKind` into its remediation line.
 *
 * The backend also ships an English `blocker.detail`, but that string is
 * assembled in Rust and can never be localized — so the kind token (which IS
 * language-agnostic) is what the UI renders from. `cli_login` is the newest
 * kind: the connector is satisfied by an authenticated provider CLI on this
 * machine, so its fix is a terminal `login`, not a Vault round-trip.
 */
function remediationFor(t: Translations, kind: SetupKind): string {
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

/** Build the tooltip text — the readiness preview plus one line per blocker. */
function setupTooltip(t: Translations, setup: PersonaSetup | null): string {
  if (!setup) {
    return t.vault.setup_kind.generic;
  }
  const lines = [setup.preview];
  for (const blocker of setup.blockers) {
    lines.push(`• ${blocker.connector} — ${remediationFor(t, blocker.kind)}`);
  }
  return lines.join('\n');
}

export function SetupStatusBadge({
  status,
  setupDetail,
  variant = 'compact',
  className = '',
}: Props) {
  const { t } = useTranslation();
  const key = (status ?? 'ready') as Status;

  // Don't render anything for the happy path — only surface when attention needed.
  if (key === 'ready') {
    if (variant === 'inline') {
      return (
        <span className={`inline-flex items-center gap-1 typo-caption text-emerald-400/80 ${className}`}>
          <CheckCircle2 className="w-3 h-3" /> Ready
        </span>
      );
    }
    return null;
  }

  if (key === 'needs_credentials') {
    // Warning icon only — compact enough to sit on the same row as the primary
    // status badge instead of wrapping onto its own line. The tooltip (and
    // aria-label) still name exactly which connectors need setup.
    return (
      <span
        className={`inline-flex items-center justify-center text-amber-400 ${className}`}
        title={setupTooltip(t, parseSetup(setupDetail))}
        aria-label={debtText('auto_setup_required_9fa0e005')}
      >
        <AlertTriangle className="w-4 h-4" />
      </span>
    );
  }

  // misconfigured (future expansion)
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-card typo-caption font-medium bg-red-500/10 text-red-400 border border-red-500/30 ${className}`}
      title={debtText("auto_this_persona_has_a_configuration_problem_s_f9c78e89")}
    >
      <Settings className="w-3 h-3" />
      Misconfigured
    </span>
  );
}
