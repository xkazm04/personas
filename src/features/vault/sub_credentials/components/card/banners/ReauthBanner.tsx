import { useState, useCallback, useEffect } from 'react';
import { AlertTriangle, X, ExternalLink, RefreshCw, Loader2, Terminal } from 'lucide-react';
import { EventName, type EventPayloadMap } from '@/lib/eventRegistry';
import { useTypedTauriEvent } from '@/hooks/useTauriEvent';
import { useTranslation } from '@/i18n/useTranslation';
import { listCliSpecs, refreshCredentialCliNow, type CliSpecInfo } from '@/api/auth/cliCapture';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';

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
            className="px-4 py-3 bg-amber-600/10 border border-amber-500/25 rounded-modal typo-body text-amber-300"
          >
            <div className="flex items-center gap-2.5">
              {isCli
                ? <Terminal className="w-4 h-4 shrink-0 text-amber-400" />
                : <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />}
              <span className="flex-1">
                <strong>{entry.credentialName}</strong> ({entry.serviceType}
                {isCli ? t.vault.reauth_banner.cli_expired : t.vault.reauth_banner.access_revoked}
              </span>
              {isCli ? (
                <button
                  onClick={() => void retryCliCapture(entry)}
                  disabled={retryingId === entry.credentialId}
                  className="flex items-center gap-1 text-amber-400 hover:text-amber-300 typo-caption font-medium shrink-0 disabled:opacity-50"
                >
                  {retryingId === entry.credentialId
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <RefreshCw className="w-3 h-3" />}
                  {t.vault.reauth_banner.retry_capture}
                </button>
              ) : onNavigate && (
                <button
                  onClick={() => onNavigate(entry.credentialId)}
                  className="flex items-center gap-1 text-amber-400 hover:text-amber-300 typo-caption font-medium shrink-0"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t.vault.reauth_banner.reconnect}
                </button>
              )}
              <button
                onClick={() => dismiss(entry.credentialId)}
                className="text-amber-400/60 hover:text-amber-400 shrink-0"
                aria-label={t.common.dismiss}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {isCli && spec && (
              <div className="mt-1 pl-6 typo-caption text-amber-300/90">
                {spec.auth_instruction}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
