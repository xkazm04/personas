import { useState, useCallback, useEffect } from 'react';
import { EventName, type EventPayloadMap } from '@/lib/eventRegistry';
import { useTypedTauriEvent } from '@/hooks/useTauriEvent';
import { useTranslation } from '@/i18n/useTranslation';
import { listCliSpecs, refreshCredentialCliNow, type CliSpecInfo } from '@/api/auth/cliCapture';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useVaultStore } from '@/stores/vaultStore';
import { parseCredentialLedger } from '@/lib/credentials/parseCredentialLedger';
import { readCredentialAccount } from '@/features/vault/shared/credentialAccount';
import { ReauthEntryRow, type ReauthEntry } from './ReauthEntryRow';

/**
 * The `accountEmail` the Rust side adds to this event's payload. Typed locally
 * because `eventRegistry.ts` is owned by that half of the change — an optional
 * field read through an intersection compiles either way and needs no cast.
 */
type ReauthRequiredPayload =
  EventPayloadMap[typeof EventName.CREDENTIAL_REAUTH_REQUIRED] & { accountEmail?: string | null };

/**
 * Banner displayed when one or more credentials have lost their grant.
 * Listens for the `credential-reauth-required` Tauri event emitted by the
 * backend's OAuth refresh engine and accumulates entries until the user
 * dismisses them.
 *
 * Three re-auth shapes (the row component picks between them):
 * - Google OAuth credentials: reconnect IN PLACE, bound to the account already
 *   recorded on the credential, without leaving the banner.
 * - Other OAuth credentials: open the credential in the vault, whose
 *   Authentication section is the re-consent surface (`onNavigate`).
 * - CLI-captured credentials (`source === "cli"`): the underlying CLI session
 *   expired — the user signs in via their terminal (e.g. `gcloud auth login`)
 *   and then retries the capture from here.
 */
export function ReauthBanner({ onNavigate }: { onNavigate?: (credentialId: string) => void }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ReauthEntry[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [cliSpecs, setCliSpecs] = useState<CliSpecInfo[] | null>(null);

  const handleReauthRequired = useCallback(
    (payload: EventPayloadMap[typeof EventName.CREDENTIAL_REAUTH_REQUIRED]) => {
      const p = payload as ReauthRequiredPayload;
      setEntries((prev) => {
        // Deduplicate by credentialId
        if (prev.some((e) => e.credentialId === p.credentialId)) return prev;
        return [...prev, {
          credentialId: p.credentialId,
          credentialName: p.credentialName,
          serviceType: p.serviceType,
          source: p.source ?? null,
          accountEmail: p.accountEmail ?? null,
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
          accountEmail: readCredentialAccount(c.metadata).email,
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
    try {
      await refreshCredentialCliNow(entry.credentialId);
      useToastStore.getState().addToast(t.vault.reauth_banner.retry_success, 'success', 4000);
      dismiss(entry.credentialId);
    } catch (err) {
      toastCatch('ReauthBanner:retryCliCapture')(err);
    }
  }, [dismiss, t]);

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <ReauthEntryRow
          key={entry.credentialId}
          entry={entry}
          cliSpec={entry.source === 'cli'
            ? cliSpecs?.find((s) => s.service_type === entry.serviceType) ?? null
            : null}
          onNavigate={onNavigate}
          onDismiss={dismiss}
          onRetryCli={retryCliCapture}
        />
      ))}
    </div>
  );
}
