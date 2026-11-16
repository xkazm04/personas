import { useTranslation } from '@/i18n/useTranslation';
import { useEffect, useState } from 'react';
import { History, Calendar } from 'lucide-react';
import { getCredentialAuditLog } from '@/api/vault/credentials';
import { silentCatch } from '@/lib/silentCatch';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { inlineErrorCopy } from '@/features/triggers/lib/inlineErrorCopy';
import type { CredentialAuditEntry } from '@/lib/bindings/CredentialAuditEntry';
import { formatTimestamp } from '@/lib/utils/formatters';

interface ExecutionsTabProps {
  credentialId: string;
  createdAt: string;
}

const OP_STYLES: Record<string, string> = {
  decrypt: 'bg-status-info/10 border-status-info/20 text-status-info',
  create: 'bg-status-success/10 border-status-success/20 text-status-success',
  update: 'bg-status-warning/10 border-status-warning/20 text-status-warning',
  delete: 'bg-status-error/10 border-status-error/20 text-status-error',
  healthcheck: 'bg-role-highlight/10 border-role-highlight/20 text-role-highlight',
};

export function ExecutionsTab({ credentialId, createdAt }: ExecutionsTabProps) {
  const { t } = useTranslation();
  const sh = t.vault.shared;
  const [entries, setEntries] = useState<CredentialAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed read is not an empty history: it used to fire an English toast
  // (rendered as the generic sentence) while the list below said "No recorded
  // activity yet", which states a fact nobody checked.
  const [loadError, setLoadError] = useState<{ raw: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getCredentialAuditLog(credentialId, 10)
      .then((data) => { if (!cancelled) setEntries(data); })
      .catch((err: unknown) => {
        silentCatch('ExecutionsTab:fetchAuditLog')(err);
        if (!cancelled) setLoadError({ raw: err });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [credentialId, attempt]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2 typo-body text-foreground">
        <Calendar className="w-3.5 h-3.5" />
        <span>{sh.label_created} {formatTimestamp(createdAt, '--')}</span>
      </div>

      <div className="space-y-1.5">
        <h3 className="typo-heading text-foreground flex items-center gap-2">
          <History className="w-3.5 h-3.5" />
          {sh.recent_activity}
        </h3>

        {loadError && (
          <InlineErrorBanner
            message={inlineErrorCopy(t, loadError.raw)}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        )}

        {!loading && !loadError && entries.length === 0 && (
          <div className="typo-body text-foreground py-4 text-center border border-dashed border-hair rounded-card">
            {sh.no_recorded_activity}
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="space-y-1">
            {entries.map((entry) => {
              const opStyle = OP_STYLES[entry.operation] ?? 'bg-surface-2 border-hair text-foreground';
              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 px-3 py-2 bg-secondary/15 border border-primary/8 rounded-card"
                >
                  <span className={`typo-code px-1.5 py-0.5 rounded-interactive border shrink-0 ${opStyle}`}>
                    {entry.operation}
                  </span>
                  <div className="flex-1 min-w-0 typo-body text-foreground truncate">
                    {entry.personaName && (
                      <span className="text-foreground">{entry.personaName}</span>
                    )}
                    {entry.detail && (
                      <span className="text-foreground">{entry.personaName ? ' · ' : ''}{entry.detail}</span>
                    )}
                    {!entry.personaName && !entry.detail && (
                      <span className="text-foreground italic">--</span>
                    )}
                  </div>
                  <span className="typo-body text-foreground shrink-0">
                    {formatTimestamp(entry.createdAt, '')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
