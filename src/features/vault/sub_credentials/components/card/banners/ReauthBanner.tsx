import { useState, useCallback, useEffect } from 'react';
import { AlertTriangle, X, ExternalLink, RefreshCw, Loader2, Terminal } from 'lucide-react';
import { EventName, type EventPayloadMap } from '@/lib/eventRegistry';
import { useTypedTauriEvent } from '@/hooks/useTauriEvent';
import { useTranslation } from '@/i18n/useTranslation';
import { listCliSpecs, refreshCredentialCliNow, type CliSpecInfo } from '@/api/auth/cliCapture';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useVaultStore } from '@/stores/vaultStore';
import { parseCredentialLedger } from '@/lib/credentials/parseCredentialLedger';
import { STATUS_PALETTE } from '@/lib/design/statusTokens';

const WARNING = STATUS_PALETTE.warning;

interface ReauthEntry {
  credentialId: string;
  credentialName: string;
  serviceType: string;
  source: string | null;
}

/**
 * Banner displayed when one or more credentials have lost their grant.
 * Listens for the `credential-reauth-required` Tauri event emitted by the
 * backend's OAuth refresh engine and accumulates entries until the user
 * dismisses them.
 *
 * Two re-auth shapes:
 * - OAuth credentials: the grant was revoked at the provider — the user must
 *   reconnect through the vault (optional `onNavigate`).
 * - CLI-captured credentials (`source === "cli"`): the underlying CLI session
 *   expired — the user signs in via their terminal (e.g. `gcloud auth login`)
 *   and then retries the capture from here, without leaving the app.
 */
export function ReauthBanner({ onNavigate }: { onNavigate?: (credentialId: string) => void }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ReauthEntry[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [cliSpecs, setCliSpecs] = useState<CliSpecInfo[] | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const handleReauthRequired = useCallback(
    (payload: EventPayloadMap[typeof EventName.CREDENTIAL_REAUTH_REQUIRED]) => {
      setEntries((prev) => {
        // Deduplicate by credentialId
        if (prev.some((e) => e.credentialId === payload.credentialId)) return prev;
        return [...prev, {
          credentialId: payload.credentialId,
          credentialName: payload.credentialName,
          serviceType: payload.serviceType,
          source: payload.source ?? null,
        }];
      });
    },
    [],
  );
  useTypedTauriEvent(EventName.CREDENTIAL_REAUTH_REQUIRED, handleReauthRequired);

  // Grant restored (successful OAuth reconnect or CLI recapture) — drop the
  // matching entry so the banner resolves itself without a manual dismiss.
  const handleReauthResolved = useCallback(
    (payload: EventPayloadMap[typeof EventName.CREDENTIAL_REAUTH_RESOLVED]) => {
      setEntries((prev) => prev.filter((e) => e.credentialId !== payload.credentialId));
    },
    [],
  );
  useTypedTauriEvent(EventName.CREDENTIAL_REAUTH_RESOLVED, handleReauthResolved);

  // Mount-time hydration from the PERSISTED needs_reauth flag. The startup
  // OAuth sweep detects revocations and fires CREDENTIAL_REAUTH_REQUIRED
  // *before* this webview has mounted its listener — so the most common
  // discovery path (revoked while the app was closed) would otherwise never
  // show the banner (smoke 2026-07-17: three genuinely revoked credentials,
  // empty banner). Events remain the live channel; this seeds the durable
  // state at mount. Dismiss stays session-local; an unresolved revocation
  // legitimately reappears on remount.
  const credentials = useVaultStore((s) => s.credentials);
  useEffect(() => {
    const flagged = credentials.filter(
      (c) => parseCredentialLedger(c.metadata).needs_reauth === true,
    );
    if (flagged.length === 0) return;
    setEntries((prev) => {
      const next = [...prev];
      for (const c of flagged) {
        if (dismissedIds.has(c.id)) continue;
        if (next.some((e) => e.credentialId === c.id)) continue;
        let source: string | null;
        try {
          source = c.metadata ? (JSON.parse(c.metadata).source ?? null) : null;
        } catch {
          source = null;
        }
        next.push({
          credentialId: c.id,
          credentialName: c.name,
          serviceType: c.service_type,
          source,
        });
      }
      return next.length === prev.length ? prev : next;
    });
  }, [credentials, dismissedIds]);

  // Lazily fetch CLI specs the first time a CLI-sourced entry appears, so we
  // can show the spec's login instruction (e.g. "Run `gcloud auth login`...").
  const hasCliEntry = entries.some((e) => e.source === 'cli');
  useEffect(() => {
    if (!hasCliEntry || cliSpecs !== null) return;
    listCliSpecs().then(setCliSpecs).catch((e) => {
      silentCatch('ReauthBanner:listCliSpecs')(e);
      setCliSpecs([]);
    });
  }, [hasCliEntry, cliSpecs]);

  const dismiss = useCallback((credentialId: string) => {
    setDismissedIds((prev) => new Set(prev).add(credentialId));
    setEntries((prev) => prev.filter((e) => e.credentialId !== credentialId));
  }, []);

  const retryCliCapture = useCallback(async (entry: ReauthEntry) => {
    setRetryingId(entry.credentialId);
    try {
      await refreshCredentialCliNow(entry.credentialId);
      useToastStore.getState().addToast(t.vault.reauth_banner.retry_success, 'success', 4000);
      dismiss(entry.credentialId);
    } catch (err) {
      toastCatch('ReauthBanner:retryCliCapture')(err);
    } finally {
      setRetryingId(null);
    }
  }, [dismiss, t]);

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const isCli = entry.source === 'cli';
        const spec = isCli
          ? cliSpecs?.find((s) => s.service_type === entry.serviceType) ?? null
          : null;
        return (
          <div
            key={entry.credentialId}
            role="alert"
            className={`px-4 py-3 ${WARNING.bg} border ${WARNING.border} rounded-modal typo-body ${WARNING.text}`}
          >
            <div className="flex items-center gap-2.5">
              {isCli
                ? <Terminal className={`w-4 h-4 shrink-0 ${WARNING.text}`} />
                : <AlertTriangle className={`w-4 h-4 shrink-0 ${WARNING.text}`} />}
              <span className="flex-1">
                <strong>{entry.credentialName}</strong> ({entry.serviceType}
                {isCli ? t.vault.reauth_banner.cli_expired : t.vault.reauth_banner.access_revoked}
              </span>
              {isCli ? (
                <button
                  onClick={() => void retryCliCapture(entry)}
                  disabled={retryingId === entry.credentialId}
                  className={`flex items-center gap-1 ${WARNING.text} hover:opacity-80 typo-caption font-medium shrink-0 disabled:opacity-50 focus-ring rounded-card`}
                >
                  {retryingId === entry.credentialId
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <RefreshCw className="w-3 h-3" />}
                  {t.vault.reauth_banner.retry_capture}
                </button>
              ) : onNavigate && (
                <button
                  onClick={() => onNavigate(entry.credentialId)}
                  data-testid="reauth-reconnect"
                  className={`flex items-center gap-1 ${WARNING.text} hover:opacity-80 typo-caption font-medium shrink-0 focus-ring rounded-card`}
                >
                  <ExternalLink className="w-3 h-3" />
                  {t.vault.reauth_banner.reconnect}
                </button>
              )}
              <button
                onClick={() => dismiss(entry.credentialId)}
                className={`${WARNING.text} opacity-60 hover:opacity-100 shrink-0 focus-ring rounded-card`}
                aria-label={t.common.dismiss}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {isCli && spec && (
              <div className={`mt-1 pl-6 typo-caption ${WARNING.text} opacity-90`}>
                {spec.auth_instruction}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
