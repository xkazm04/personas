import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, X, ExternalLink, RefreshCw, Terminal, UserCheck } from 'lucide-react';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useVaultStore } from '@/stores/vaultStore';
import { silentCatch } from '@/lib/silentCatch';
import { resolveError } from '@/lib/errors/errorRegistry';
import type { CliSpecInfo } from '@/api/auth/cliCapture';
import { OAUTH_FIELD } from '@/features/vault/sub_catalog/components/design/CredentialDesignHelpers';
import { useGoogleOAuth, type GoogleOAuthTokenData } from '@/features/vault/shared/hooks/useGoogleOAuth';
import { isGoogleReauthTarget, parseAccountMismatch } from '@/features/vault/shared/credentialAccount';
import { STATUS_PALETTE } from '@/lib/design/statusTokens';

const WARNING = STATUS_PALETTE.warning;

export interface ReauthEntry {
  credentialId: string;
  credentialName: string;
  serviceType: string;
  source: string | null;
  /** Bound provider account, from the event payload or the credential ledger. */
  accountEmail: string | null;
}

interface ReauthEntryRowProps {
  entry: ReauthEntry;
  /** CLI spec for a `source === "cli"` entry — carries the login instruction. */
  cliSpec: CliSpecInfo | null;
  onNavigate?: (credentialId: string) => void;
  onDismiss: (credentialId: string) => void;
  onRetryCli: (entry: ReauthEntry) => Promise<void>;
}

/**
 * One revoked-credential row in the re-auth banner.
 *
 * For a Google OAuth credential the reconnect runs IN PLACE: consent is
 * launched bound to the credential (`reconnectCredentialId`), and the returned
 * one-time session ref is saved through the same update path the playground's
 * Overview tab uses — the backend redeems it, clears `needs_reauth` and emits
 * `credential-reauth-resolved`, which is what removes this row. If the consent
 * came back with a DIFFERENT Google account the backend refuses it, the old
 * token survives, and the refusal is shown inline while the row stays.
 */
export function ReauthEntryRow({ entry, cliSpec, onNavigate, onDismiss, onRetryCli }: ReauthEntryRowProps) {
  const { t, tx } = useTranslation();
  const rb = t.vault.reauth_banner;
  const [rowError, setRowError] = useState<string | null>(null);
  const updateCredential = useVaultStore((s) => s.updateCredential);
  const connector = useVaultStore(
    (s) => s.connectorDefinitions.find((d) => d.name === entry.serviceType),
  );

  const isCli = entry.source === 'cli';
  const canReconnectInPlace = !isCli && isGoogleReauthTarget(connector, entry.serviceType);

  // Resolves the AsyncButton's promise when the OAuth round-trip settles, so
  // the button stays busy for the whole consent + save, not just the launch.
  const settleRef = useRef<(() => void) | null>(null);
  const settle = useCallback(() => {
    settleRef.current?.();
    settleRef.current = null;
  }, []);

  const persist = useCallback(async (data: GoogleOAuthTokenData) => {
    try {
      const fields: Record<string, string> = { [OAUTH_FIELD.SESSION_REF]: data.oauth_session_ref };
      if (data.scope) fields.scopes = data.scope;
      await updateCredential(entry.credentialId, { data: fields });
      setRowError(null);
      // No success state here on purpose: the row disappears when the backend
      // emits `credential-reauth-resolved`, which is the real proof.
    } catch (err) {
      const mismatch = parseAccountMismatch(err);
      if (mismatch) {
        setRowError(mismatch.detail ? `${rb.account_mismatch} (${mismatch.detail})` : rb.account_mismatch);
      } else {
        setRowError(resolveError(err instanceof Error ? err.message : String(err)).message);
        silentCatch('ReauthEntryRow:persist')(err);
      }
    } finally {
      settle();
    }
  }, [entry.credentialId, rb.account_mismatch, settle, updateCredential]);

  const oauth = useGoogleOAuth({
    onSuccess: (data) => { void persist(data); },
    onError: (message) => { setRowError(message || rb.reconnect_failed); settle(); },
  });

  const reconnect = useCallback(() => new Promise<void>((resolve) => {
    setRowError(null);
    settleRef.current = resolve;
    oauth.startConsent(connector?.name || entry.serviceType, undefined, entry.credentialId);
  }), [connector?.name, entry.credentialId, entry.serviceType, oauth]);

  return (
    <div
      role="alert"
      data-testid={`reauth-entry-${entry.credentialId}`}
      className={`px-4 py-3 ${WARNING.bg} border ${WARNING.border} rounded-modal typo-body ${WARNING.text}`}
    >
      <div className="flex items-center gap-2.5">
        {isCli
          ? <Terminal className={`w-4 h-4 shrink-0 ${WARNING.text}`} />
          : <AlertTriangle className={`w-4 h-4 shrink-0 ${WARNING.text}`} />}
        <span className="flex-1 min-w-0">
          <strong>{entry.credentialName}</strong> ({entry.serviceType}
          {isCli ? rb.cli_expired : rb.access_revoked}
        </span>
        {isCli ? (
          <AsyncButton
            variant="ghost"
            size="xs"
            icon={<RefreshCw className="w-3 h-3" />}
            loadingText={rb.retry_capture}
            onClick={() => onRetryCli(entry)}
            className={`${WARNING.text} shrink-0`}
          >
            {rb.retry_capture}
          </AsyncButton>
        ) : (
          <>
            {canReconnectInPlace && (
              <AsyncButton
                variant="primary"
                size="xs"
                icon={<RefreshCw className="w-3 h-3" />}
                loadingText={rb.reconnecting}
                data-testid="reauth-reconnect-now"
                onClick={reconnect}
                className="shrink-0"
              >
                {rb.reconnect_now}
              </AsyncButton>
            )}
            {onNavigate && (
              <Button
                variant="ghost"
                size="xs"
                icon={<ExternalLink className="w-3 h-3" />}
                onClick={() => onNavigate(entry.credentialId)}
                data-testid="reauth-reconnect"
                className={`${WARNING.text} shrink-0`}
              >
                {canReconnectInPlace ? rb.open_in_vault : rb.reconnect}
              </Button>
            )}
          </>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onDismiss(entry.credentialId)}
          aria-label={t.common.dismiss}
          className={`${WARNING.text} opacity-60 hover:opacity-100 shrink-0`}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {!isCli && (
        <div className={`mt-1 pl-6 flex items-center gap-1.5 typo-caption ${WARNING.text} opacity-90`}>
          <UserCheck className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span data-testid="reauth-account-line">
            {entry.accountEmail
              ? tx(rb.signed_in_as, { email: entry.accountEmail })
              : rb.account_not_recorded}
          </span>
        </div>
      )}

      {/* Mounted empty and UNCONDITIONALLY so a refusal is ANNOUNCED when it
          arrives rather than being present from first paint (a region born
          with its message is not read out by assistive tech). `isCli` is fixed
          for the row's lifetime, so a CLI row simply keeps it hidden instead
          of gating the mount behind a conditional. */}
      <div
        role="status"
        hidden={isCli}
        className={`mt-1 pl-6 typo-caption ${WARNING.text}`}
        data-testid="reauth-row-error"
      >
        {isCli ? null : rowError}
      </div>

      {isCli && cliSpec && (
        <div className={`mt-1 pl-6 typo-caption ${WARNING.text} opacity-90`}>
          {cliSpec.auth_instruction}
        </div>
      )}
    </div>
  );
}
