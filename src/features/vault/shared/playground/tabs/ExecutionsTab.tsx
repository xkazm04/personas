import { useEffect, useState } from 'react';
import { History, Calendar } from 'lucide-react';
import { getCredentialAuditLog } from '@/api/vault/credentials';
import { toastCatch } from "@/lib/silentCatch";
import type { CredentialAuditEntry } from '@/lib/bindings/CredentialAuditEntry';
import { formatTimestamp } from '@/lib/utils/formatters';

interface ExecutionsTabProps {
  credentialId: string;
  createdAt: string;
}

const OP_STYLES: Record<string, string> = {
  decrypt: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
  create: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
  update: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
  delete: 'bg-red-500/10 border-red-500/20 text-red-400',
  healthcheck: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400',
};

export function ExecutionsTab({ credentialId, createdAt }: ExecutionsTabProps) {
  const [entries, setEntries] = useState<CredentialAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCredentialAuditLog(credentialId, 10)
      .then((data) => { if (!cancelled) setEntries(data); })
      .catch(toastCatch("ExecutionsTab:fetchAuditLog", "Failed to load audit history"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [credentialId]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2 text-sm text-foreground">
        <Calendar className="w-3.5 h-3.5" />
        <span>Created {formatTimestamp(createdAt, 'Unknown')}</span>
      </div>

      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <History className="w-3.5 h-3.5" />
          Recent Activity
        </h3>

        {!loading && entries.length === 0 && (
          <div className="text-sm text-foreground py-4 text-center border border-dashed border-primary/15 rounded-card">
            No recorded activity yet
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="space-y-1">
            {entries.map((entry) => {
              const opStyle = OP_STYLES[entry.operation] ?? 'bg-secondary/40 border-primary/15 text-foreground';
              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 px-3 py-2 bg-secondary/15 border border-primary/8 rounded-card"
                >
                  <span className={`text-sm font-mono px-1.5 py-0.5 rounded border shrink-0 ${opStyle}`}>
                    {entry.operation}
                  </span>
                  <div className="flex-1 min-w-0 text-sm text-foreground truncate">
                    {entry.persona_name && (
                      <span className="text-foreground">{entry.persona_name}</span>
                    )}
                    {entry.detail && (
                      <span className="text-foreground">{entry.persona_name ? ' · ' : ''}{entry.detail}</span>
                    )}
                    {!entry.persona_name && !entry.detail && (
                      <span className="text-foreground italic">--</span>
                    )}
                  </div>
                  <span className="text-sm text-foreground shrink-0">
                    {formatTimestamp(entry.created_at, '')}
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
