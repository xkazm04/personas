import { AlertTriangle, Settings, CheckCircle2 } from 'lucide-react';
import type { PersonaSetup } from '@/lib/bindings/PersonaSetup';
import { DebtText, debtText } from '@/i18n/DebtText';


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

/** Build the tooltip text — the readiness preview plus one line per blocker. */
function setupTooltip(setup: PersonaSetup | null): string {
  if (!setup) {
    return 'One or more declared connectors need setup. Open the persona to see what each requires.';
  }
  const lines = [setup.preview];
  for (const blocker of setup.blockers) {
    lines.push(`• ${blocker.detail}`);
  }
  return lines.join('\n');
}

export function SetupStatusBadge({
  status,
  setupDetail,
  variant = 'compact',
  className = '',
}: Props) {
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
    return (
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-card typo-caption font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 ${className}`}
        title={setupTooltip(parseSetup(setupDetail))}
      >
        <AlertTriangle className="w-3 h-3" />
        <DebtText k="auto_setup_required_9fa0e005" />
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
