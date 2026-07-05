/**
 * Per-key audit drawer — shows the recent management-API requests a key made
 * (method / path / status / persona / origin / time), read via the
 * `list_api_key_audit` command. Gives the owner an at-a-glance trail of exactly
 * what each key has done, beyond the row's `last_used_at`.
 */
import { useEffect, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { listApiKeyAudit, type ApiKeyAuditEntry } from '@/api/auth/externalApiKeys';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { formatRelativeTime, formatTimestamp } from '@/lib/utils/formatters';

interface ApiKeyAuditDrawerProps {
  keyId: string;
  keyName: string;
  onClose: () => void;
}

function statusColor(status: number): string {
  if (status < 300) return 'text-emerald-400';
  if (status < 500) return 'text-amber-400';
  return 'text-red-400';
}

export function ApiKeyAuditDrawer({ keyId, keyName, onClose }: ApiKeyAuditDrawerProps) {
  const { t } = useTranslation();
  const s = t.settings.api_keys;

  const [rows, setRows] = useState<ApiKeyAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listApiKeyAudit(keyId, 200)
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [keyId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 surface-blur-modal"
      onClick={onClose}
    >
      <div
        className="bg-secondary border border-border/40 rounded-modal shadow-elevation-3 w-full max-w-lg mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="min-w-0">
            <h2 className="typo-body font-medium text-foreground truncate">{s.audit_title}</h2>
            <p className="typo-caption text-foreground truncate">{keyName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-3 overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 typo-caption text-red-400 bg-red-400/10 rounded p-2 mb-2">
              <AlertTriangle size={14} />
              {error}
            </div>
          )}

          {rows === null && !error && (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="sm" />
            </div>
          )}

          {rows !== null && rows.length === 0 && (
            <div className="typo-caption text-foreground py-8 text-center bg-secondary/20 rounded">
              {s.audit_empty}
            </div>
          )}

          {rows !== null && rows.length > 0 && (
            <div className="space-y-1">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-input bg-secondary/20 border border-border/20"
                >
                  <span className={`typo-code font-medium ${statusColor(Number(row.status))}`}>
                    {String(row.status)}
                  </span>
                  <span className="typo-code text-foreground w-10 shrink-0">{row.method}</span>
                  <code className="typo-code text-foreground truncate flex-1" title={row.path}>
                    {row.path}
                  </code>
                  {row.origin && (
                    <span className="typo-caption text-foreground truncate max-w-[8rem]" title={row.origin}>
                      {row.origin}
                    </span>
                  )}
                  <span
                    className="typo-caption text-foreground shrink-0"
                    title={formatTimestamp(row.at)}
                  >
                    {formatRelativeTime(row.at, '', { dateFallbackDays: 7 })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
