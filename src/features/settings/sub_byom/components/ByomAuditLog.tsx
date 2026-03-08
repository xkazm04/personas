import type { ProviderAuditEntry } from '@/api/byom';
import { ENGINE_LABELS } from '../libs/byomHelpers';

interface ByomAuditLogProps {
  auditLog: ProviderAuditEntry[];
}

export function ByomAuditLog({ auditLog }: ByomAuditLogProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-3">
        <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
          Provider Audit Log
        </h2>
        <p className="text-sm text-muted-foreground/60">
          Compliance trail showing which provider handled each execution
        </p>

        {auditLog.length === 0 ? (
          <p className="text-sm text-muted-foreground/50 text-center py-6">
            No audit entries yet. Entries are recorded automatically for every execution.
          </p>
        ) : (
          <div className="border border-primary/10 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary/10 bg-secondary/30">
                  <th className="text-left p-2.5 text-muted-foreground/70 font-medium">Provider</th>
                  <th className="text-left p-2.5 text-muted-foreground/70 font-medium">Model</th>
                  <th className="text-left p-2.5 text-muted-foreground/70 font-medium">Persona</th>
                  <th className="text-left p-2.5 text-muted-foreground/70 font-medium">Status</th>
                  <th className="text-right p-2.5 text-muted-foreground/70 font-medium">Cost</th>
                  <th className="text-right p-2.5 text-muted-foreground/70 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map((entry) => (
                  <tr key={entry.id} className="border-b border-primary/5 hover:bg-secondary/20">
                    <td className="p-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-foreground">
                          {ENGINE_LABELS[entry.engine_kind] || entry.engine_kind}
                        </span>
                        {entry.was_failover && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">
                            failover
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-2.5 text-muted-foreground/70">
                      {entry.model_used || '-'}
                    </td>
                    <td className="p-2.5 text-muted-foreground/70">
                      {entry.persona_name}
                    </td>
                    <td className="p-2.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        entry.status === 'completed'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : entry.status === 'failed'
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-secondary/50 text-muted-foreground/70'
                      }`}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="p-2.5 text-right text-muted-foreground/70">
                      {entry.cost_usd != null ? `$${entry.cost_usd.toFixed(4)}` : '-'}
                    </td>
                    <td className="p-2.5 text-right text-muted-foreground/70">
                      {entry.duration_ms != null ? `${Math.round(entry.duration_ms / 1000)}s` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
