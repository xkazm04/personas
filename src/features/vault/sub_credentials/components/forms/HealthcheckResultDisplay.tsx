import { useState, useMemo } from 'react';
import { CheckCircle, PlugZap, ShieldQuestion, XCircle, ChevronDown } from 'lucide-react';
import { translateHealthcheckMessage } from '@/features/vault/sub_catalog/components/design/CredentialDesignHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveProbeOutcome } from '@/lib/credentials/healthState';

/**
 * A probe has four outcomes and this display had two.
 *
 * It keyed on `success` alone, so `unverifiable` -- the connector exposes no
 * live probe, which the backend deliberately returns as `success: true` --
 * drew the green check and claimed a verification nothing performed, while
 * `unreachable` (DNS, timeout, airplane mode) drew the red error and read as
 * "your key is wrong". Both are the ABSENCE of a verdict and now share a
 * neutral treatment that says so.
 */
export function HealthcheckResultDisplay({
  success,
  message,
  state,
}: {
  success: boolean;
  message: string;
  /** Typed probe state. Absent on legacy/persisted results; the boolean is
   *  then the only evidence there is. */
  state?: string | null;
}) {
  const { t, tx } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const translated = useMemo(() => translateHealthcheckMessage(message, t, tx), [message, t, tx]);
  const hasDifferentRaw = translated.raw !== translated.friendly;
  const hasSuggestion = translated.suggestion.length > 0;
  const outcome = resolveProbeOutcome({ success, state });

  if (outcome === 'unverifiable' || outcome === 'unreachable') {
    const Icon = outcome === 'unverifiable' ? ShieldQuestion : PlugZap;
    return (
      <div
        data-testid="healthcheck-result"
        data-state={outcome}
        className="animate-fade-slide-in mt-2 flex items-start gap-2 px-3 py-2 rounded-modal typo-body bg-secondary/40 border border-border/40 text-foreground"
      >
        <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="font-semibold">
            {outcome === 'unverifiable'
              ? t.vault.shared.health_unverifiable
              : t.vault.shared.health_unreachable}
          </p>
          {message && <p className="break-all">{message}</p>}
        </div>
      </div>
    );
  }

  if (outcome === 'verified') {
    return (
      <div
        data-testid="healthcheck-result"
        data-state="verified"
        className="animate-fade-slide-in mt-2 flex items-start gap-2 px-3 py-2 rounded-modal typo-body bg-status-success/10 border border-status-success/20 text-status-success"
      >
        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>{message}</span>
      </div>
    );
  }

  return (
    <div
      data-testid="healthcheck-result"
      data-state="failed"
      className="animate-fade-in mt-2 rounded-modal bg-status-error/10 border border-status-error/20 overflow-hidden"
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-status-error" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="typo-body text-status-error">{translated.friendly}</p>
          {hasSuggestion && (
            <p className="typo-body text-status-error/60">{translated.suggestion}</p>
          )}
        </div>
      </div>

      {hasDifferentRaw && (
        <div className="border-t border-status-error/10">
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 typo-body text-status-error/40 hover:text-status-error/60 transition-colors"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
            {t.vault.forms.technical_details}
          </button>
          {showDetails && (
            <p className="px-3 pb-2 typo-code text-status-error/30 font-mono break-all">
              {translated.raw}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
