import { useEffect, useState } from 'react';
import { Activity, Users, Clock, Shield, AlertTriangle } from 'lucide-react';
import { formatTimestamp } from '@/lib/utils/formatters';
import {
  getCredentialAuditLog,
  getCredentialUsageStats,
  getCredentialDependents,
} from '@/api/credentials';
import type { CredentialAuditEntry } from '@/lib/bindings/CredentialAuditEntry';
import type { CredentialUsageStats } from '@/lib/bindings/CredentialUsageStats';
import type { CredentialDependent } from '@/lib/bindings/CredentialDependent';

interface CredentialIntelligenceProps {
  credentialId: string;
}

type IntelTab = 'overview' | 'dependents' | 'audit';

const OP_LABELS: Record<string, { label: string; color: string }> = {
  decrypt: { label: 'Decrypted', color: 'text-blue-400' },
  create: { label: 'Created', color: 'text-emerald-400' },
  update: { label: 'Updated', color: 'text-amber-400' },
  delete: { label: 'Deleted', color: 'text-red-400' },
  healthcheck: { label: 'Healthcheck', color: 'text-indigo-400' },
};

export function CredentialIntelligence({ credentialId }: CredentialIntelligenceProps) {
  const [tab, setTab] = useState<IntelTab>('overview');
  const [stats, setStats] = useState<CredentialUsageStats | null>(null);
  const [dependents, setDependents] = useState<CredentialDependent[]>([]);
  const [auditLog, setAuditLog] = useState<CredentialAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      getCredentialUsageStats(credentialId),
      getCredentialDependents(credentialId),
      getCredentialAuditLog(credentialId, 30),
    ])
      .then(([s, d, a]) => {
        if (cancelled) return;
        setStats(s);
        setDependents(d);
        setAuditLog(a);
      })
      .catch(() => {
        // silently fail — intelligence is non-critical
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [credentialId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-muted-foreground/50">
        <div className="w-3 h-3 border border-primary/30 border-t-transparent rounded-full animate-spin mr-2" />
        Loading intelligence...
      </div>
    );
  }

  const hasActivity = stats && stats.total_accesses > 0;
  const unusedDays = stats?.last_accessed_at
    ? Math.floor((Date.now() - new Date(stats.last_accessed_at).getTime()) / 86400000)
    : null;

  return (
    <div className="space-y-3">
      {/* Sub-tabs */}
      <div className="flex gap-1">
        {(['overview', 'dependents', 'audit'] as IntelTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
              tab === t
                ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/25'
                : 'text-muted-foreground/40 hover:text-foreground/60 hover:bg-secondary/40'
            }`}
          >
            {t === 'overview' && 'Overview'}
            {t === 'dependents' && `Dependents (${dependents.length})`}
            {t === 'audit' && `Audit Log (${auditLog.length})`}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && stats && (
        <div className="space-y-3">
          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              icon={<Activity className="w-3.5 h-3.5 text-blue-400" />}
              label="Total Accesses"
              value={stats.total_accesses.toString()}
            />
            <StatCard
              icon={<Users className="w-3.5 h-3.5 text-indigo-400" />}
              label="Distinct Personas"
              value={stats.distinct_personas.toString()}
            />
            <StatCard
              icon={<Clock className="w-3.5 h-3.5 text-amber-400" />}
              label="Last 24h"
              value={stats.accesses_last_24h.toString()}
            />
            <StatCard
              icon={<Shield className="w-3.5 h-3.5 text-emerald-400" />}
              label="Last 7 Days"
              value={stats.accesses_last_7d.toString()}
            />
          </div>

          {/* Alerts */}
          {!hasActivity && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/8 border border-amber-500/15 rounded-lg text-xs text-amber-400/80">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              No recorded usage. This credential may be unused.
            </div>
          )}
          {unusedDays !== null && unusedDays > 30 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/8 border border-amber-500/15 rounded-lg text-xs text-amber-400/80">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Last accessed {unusedDays} days ago. Consider reviewing if still needed.
            </div>
          )}

          {/* Timeline */}
          {stats.first_accessed_at && (
            <div className="text-[11px] text-muted-foreground/40 space-y-0.5">
              <div>First accessed: {formatTimestamp(stats.first_accessed_at, 'Never')}</div>
              <div>Last accessed: {formatTimestamp(stats.last_accessed_at, 'Never')}</div>
            </div>
          )}
        </div>
      )}

      {/* Dependents tab */}
      {tab === 'dependents' && (
        <div className="space-y-1.5">
          {dependents.length === 0 ? (
            <div className="text-xs text-muted-foreground/40 py-3 text-center">
              No known dependents. Changes to this credential are low-risk.
            </div>
          ) : (
            <>
              <div className="text-[11px] text-muted-foreground/40 pb-1">
                Changing or deleting this credential will affect {dependents.length} persona{dependents.length !== 1 ? 's' : ''}:
              </div>
              {dependents.map((dep) => (
                <div
                  key={dep.persona_id}
                  className="flex items-center justify-between px-3 py-2 bg-secondary/20 border border-primary/10 rounded-lg"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                    <span className="text-xs text-foreground/80 truncate">{dep.persona_name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md border ${
                      dep.link_type === 'tool_connector'
                        ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                        : 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                    }`}>
                      {dep.link_type === 'tool_connector' ? 'structural' : 'observed'}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground/40 shrink-0">
                    {dep.via_connector && <span>via {dep.via_connector}</span>}
                    {dep.last_used_at && <span> · {formatTimestamp(dep.last_used_at, '')}</span>}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Audit log tab */}
      {tab === 'audit' && (
        <div className="space-y-1">
          {auditLog.length === 0 ? (
            <div className="text-xs text-muted-foreground/40 py-3 text-center">
              No audit entries yet. Operations will be logged as they occur.
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto space-y-0.5 pr-1">
              {auditLog.map((entry) => {
                const op = OP_LABELS[entry.operation] ?? { label: entry.operation, color: 'text-muted-foreground' };
                return (
                  <div
                    key={entry.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/30 transition-colors group"
                  >
                    <span className={`text-[10px] font-medium w-16 shrink-0 ${op.color}`}>
                      {op.label}
                    </span>
                    <span className="text-[11px] text-foreground/60 truncate flex-1">
                      {entry.persona_name
                        ? `by ${entry.persona_name}`
                        : entry.detail ?? ''}
                    </span>
                    <span className="text-[10px] text-muted-foreground/30 shrink-0 tabular-nums">
                      {formatTimestamp(entry.created_at, '')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 bg-secondary/20 border border-primary/10 rounded-lg">
      {icon}
      <div>
        <div className="text-sm font-semibold text-foreground/90 tabular-nums">{value}</div>
        <div className="text-[10px] text-muted-foreground/40">{label}</div>
      </div>
    </div>
  );
}
