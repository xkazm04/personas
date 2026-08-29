import { Star, ArrowLeftRight, AlertCircle, X, CheckCircle2, XCircle, Clock, ShieldQuestion } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { translateHealthcheckMessage } from '@/features/vault/sub_catalog/components/design/CredentialDesignHelpers';
import type { CredentialMetadata } from '@/lib/types/types';
import type { ConnectorStatus, ConnectorTestResult } from '../../libs/connectorTypes';
import { isStaleResult, STATUS_CONFIG, credentialMatchesConnector } from '../../libs/connectorTypes';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

interface LinkPickerProps {
  isLinking: boolean;
  status: ConnectorStatus;
  credentials: CredentialMetadata[];
  onLinkCredential: (connectorName: string, credentialId: string, credentialName: string) => void;
}

export function LinkPicker({ isLinking, status, credentials, onLinkCredential }: LinkPickerProps) {
  const { t } = useTranslation();
  // Same predicate the hooks that produced `status.name` use. A slot may name a
  // CATEGORY (`source_control`), not a service, and a strict service_type test
  // matches nothing there -- so the one viable credential was demoted out of
  // "Best match" into the unstarred "Other credentials" list.
  const matchingCreds = credentials.filter((c) => credentialMatchesConnector(c, status.name));
  const otherCreds = credentials.filter((c) => !credentialMatchesConnector(c, status.name));

  return (
    <>
      {isLinking && (
        <div className="animate-fade-slide-in overflow-hidden"
        >
          <div className="mt-3 border border-primary/10 rounded-card bg-background/40 max-h-48 overflow-y-auto">
            {matchingCreds.length > 0 && (
              <>
                <p className="px-3 py-1.5 typo-heading font-semibold text-foreground uppercase tracking-wider border-b border-primary/10">{t.agents.connectors.st_best_match}</p>
                {matchingCreds.map((cred) => (
                  <button type="button" key={cred.id} onClick={() => onLinkCredential(status.name, cred.id, cred.name)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/40 transition-colors border-b border-primary/10 last:border-0">
                    <Star className="w-3 h-3 text-amber-400/60 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="typo-body text-foreground truncate" title={cred.name}>{cred.name}</p>
                      <p className="typo-body text-foreground">{cred.service_type}</p>
                    </div>
                  </button>
                ))}
              </>
            )}
            {otherCreds.length > 0 && (
              <>
                {matchingCreds.length > 0 && (
                  <p className="px-3 py-1.5 typo-heading font-semibold text-foreground uppercase tracking-wider border-b border-primary/10">{t.agents.connectors.st_other_creds}</p>
                )}
                {otherCreds.map((cred) => (
                  <button type="button" key={cred.id} onClick={() => onLinkCredential(status.name, cred.id, cred.name)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/40 transition-colors border-b border-primary/10 last:border-0">
                    <div className="w-3 h-3 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="typo-body text-foreground truncate" title={cred.name}>{cred.name}</p>
                      <p className="typo-body text-foreground">{cred.service_type}</p>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

interface SwapPickerProps {
  swapOpen: boolean;
  alternatives: string[];
  statusName: string;
  onSwap: (currentName: string, newName: string) => void;
  onClose: () => void;
}

export function SwapPicker({ swapOpen, alternatives, statusName, onSwap, onClose }: SwapPickerProps) {
  const { t } = useTranslation();
  return (
    <>
      {swapOpen && alternatives.length > 0 && (
        <div className="animate-fade-slide-in overflow-hidden"
        >
          <div className="mt-3 border border-sky-500/20 rounded-card bg-background/40">
            <p className="px-3 py-1.5 text-[11px] font-semibold text-sky-400/50 uppercase tracking-wider border-b border-sky-500/10">{t.agents.connectors.st_swap_alt}</p>
            {alternatives.map((alt) => (
              <button type="button" key={alt} onClick={() => { onSwap(statusName, alt); onClose(); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-sky-500/10 transition-colors border-b border-sky-500/5 last:border-0">
                <ArrowLeftRight className="w-3 h-3 text-sky-400/50 flex-shrink-0" />
                <span className="typo-body text-foreground">{alt}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Provenance line for a restored result. Without it a healthcheck persisted
 * days ago is indistinguishable from one that just ran, which is exactly the
 * kind of confidence the connectors surface should not manufacture.
 */
function LastCheckedNote({ result, onRetest }: { result: ConnectorTestResult; onRetest?: () => void }) {
  const { t } = useTranslation();
  if (!result.cached || !result.testedAt) return null;
  const stale = isStaleResult(result);
  return (
    <p className={`typo-caption pl-4.5 flex items-center gap-1 ${stale ? 'text-amber-400' : 'text-foreground'}`}>
      {stale && <Clock className="w-3 h-3 flex-shrink-0" />}
      <span>{t.agents.connectors.st_last_checked}</span>
      <RelativeTime timestamp={result.testedAt} />
      {stale && onRetest && (
        <button
          type="button"
          onClick={onRetest}
          className="ml-1 underline underline-offset-2 hover:text-amber-300 transition-colors cursor-pointer"
        >
          {t.agents.connectors.st_retest}
        </button>
      )}
    </p>
  );
}

interface StatusResultProps {
  status: ConnectorStatus;
  onClearLinkError?: (connectorName: string) => void;
  onRetest?: () => void;
}

export function StatusResult({ status, onClearLinkError, onRetest }: StatusResultProps) {
  const { t, tx } = useTranslation();
  const translated = status.result && !status.result.success
    ? translateHealthcheckMessage(status.result.message, t, tx)
    : null;
  // `success` is `state != Failed` on the Rust side (engine/healthcheck.rs:58),
  // so an UNVERIFIABLE probe arrives with success === true. Keying the panel on
  // `success` alone therefore painted it emerald with a check mark -- exactly
  // the green "Ready" claim the three-valued state was introduced to stop the
  // UI from making. The badge above already distinguishes it; the panel does
  // now too.
  const unverifiable = status.result?.state === 'unverifiable';

  return (
    <>
      <>
        {status.linkError && (
          <div className="animate-fade-slide-in overflow-hidden"
          >
            <div className="mt-2.5 px-3 py-2 rounded-modal typo-body bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-start gap-1.5">
              <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span className="flex-1">{status.linkError}</span>
              {onClearLinkError && (
                <button type="button" onClick={() => onClearLinkError(status.name)} className="p-0.5 rounded hover:bg-amber-500/15 transition-colors flex-shrink-0">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}
      </>

      {status.result && !status.testing && (
        <div className={`mt-2.5 px-3 py-2 rounded-modal typo-body ${
          unverifiable ? `${STATUS_CONFIG.unverifiable.bg} border ${STATUS_CONFIG.unverifiable.color}`
            : status.result.success ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border border-red-500/20 text-red-400'
        }`}>
          {status.result.success ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                {unverifiable
                  ? <ShieldQuestion className="w-3 h-3 flex-shrink-0" />
                  : <CheckCircle2 className="w-3 h-3 flex-shrink-0" />}
                <span>{status.result.message || t.agents.connectors[unverifiable ? 'status_unverifiable' : 'status_ready']}</span>
              </div>
              <LastCheckedNote result={status.result} onRetest={onRetest} />
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <XCircle className="w-3 h-3 flex-shrink-0" />
                <span>{translated?.friendly ?? status.result.message}</span>
              </div>
              {translated?.suggestion && (
                <p className="typo-body text-red-400/60 pl-4.5">{translated.suggestion}</p>
              )}
              <LastCheckedNote result={status.result} onRetest={onRetest} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
