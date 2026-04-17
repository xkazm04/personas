import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, X, ExternalLink } from 'lucide-react';
import { typedListen, EventName } from '@/lib/eventRegistry';
import { useTranslation } from '@/i18n/useTranslation';

interface ReauthEntry {
  credentialId: string;
  credentialName: string;
  serviceType: string;
}

/**
 * Banner displayed when one or more OAuth credentials have had their grant
 * revoked by the provider. Listens for the `credential-reauth-required` Tauri
 * event emitted by the backend's OAuth refresh engine and accumulates entries
 * until the user dismisses them.
 */
export function ReauthBanner({ onNavigate }: { onNavigate?: (credentialId: string) => void }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ReauthEntry[]>([]);

  useEffect(() => {
    const unlisten = typedListen(EventName.CREDENTIAL_REAUTH_REQUIRED, (payload) => {
      setEntries((prev) => {
        // Deduplicate by credentialId
        if (prev.some((e) => e.credentialId === payload.credentialId)) return prev;
        return [...prev, {
          credentialId: payload.credentialId,
          credentialName: payload.credentialName,
          serviceType: payload.serviceType,
        }];
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const dismiss = useCallback((credentialId: string) => {
    setEntries((prev) => prev.filter((e) => e.credentialId !== credentialId));
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div
          key={entry.credentialId}
          role="alert"
          className="flex items-center gap-2.5 px-4 py-3 bg-amber-600/10 border border-amber-500/25 rounded-modal typo-body text-amber-300"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
          <span className="flex-1">
            <strong>{entry.credentialName}</strong> ({entry.serviceType}) -- access was revoked. Please re-authorize to resume automations.
          </span>
          {onNavigate && (
            <button
              onClick={() => onNavigate(entry.credentialId)}
              className="flex items-center gap-1 text-amber-400 hover:text-amber-300 typo-caption font-medium shrink-0"
            >
              <ExternalLink className="w-3 h-3" />
              Reconnect
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
      ))}
    </div>
  );
}
