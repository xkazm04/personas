import { useEffect, useState, useMemo } from 'react';
import { Activity, Users, Clock, Shield, AlertTriangle, ChevronLeft, ChevronRight as ChevronRightIcon } from 'lucide-react';
import { formatTimestamp, formatRelativeTime } from '@/lib/utils/formatters';
import {
  getCredentialAuditLog,
  getCredentialUsageStats,
  getCredentialDependents,
} from '@/api/credentials';
import type { CredentialAuditEntry } from '@/lib/bindings/CredentialAuditEntry';
import type { CredentialUsageStats } from '@/lib/bindings/CredentialUsageStats';
import type { CredentialDependent } from '@/lib/bindings/CredentialDependent';
import { STATUS_COLORS } from '@/lib/utils/designTokens';

const INFO_STATUS = STATUS_COLORS.info!;
const AI_STATUS = STATUS_COLORS.ai!;
const SUCCESS_STATUS = STATUS_COLORS.success!;
const WARNING_STATUS = STATUS_COLORS.warning!;
const ERROR_STATUS = STATUS_COLORS.error!;

interface CredentialIntelligenceProps {
  credentialId: string;
}

type IntelTab = 'overview' | 'dependents' | 'audit';

const OP_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  decrypt: { label: 'Decrypted', color: INFO_STATUS.color, dot: 'bg-blue-400' },
  create: { label: 'Created', color: SUCCESS_STATUS.color, dot: 'bg-emerald-400' },
  update: { label: 'Updated', color: 'text-purple-400', dot: 'bg-purple-400' },
  delete: { label: 'Deleted', color: ERROR_STATUS.color, dot: 'bg-red-400' },
  healthcheck: { label: 'Healthcheck', color: WARNING_STATUS.color, dot: 'bg-amber-400' },
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
      getCredentialAuditLog(credentialId, 500),
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
      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground/90">
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
            className={`px-2.5 py-1 rounded-xl text-sm font-medium transition-colors ${
              tab === t
                ? `${AI_STATUS.bgColor} ${AI_STATUS.color} border ${AI_STATUS.borderColor}`
                : 'text-muted-foreground/80 hover:text-foreground/95 hover:bg-secondary/40'
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
<<<<<<< HEAD
          <div className="grid grid-cols-4 3xl:grid-cols-6 4xl:grid-cols-8 gap-2">
=======
          <div className="grid grid-cols-4 gap-2">
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
            <StatCard
              icon={<Activity className={`w-3.5 h-3.5 ${INFO_STATUS.color}`} />}
              label="Total Accesses"
              value={stats.total_accesses.toString()}
            />
            <StatCard
              icon={<Users className={`w-3.5 h-3.5 ${AI_STATUS.color}`} />}
              label="Distinct Personas"
              value={stats.distinct_personas.toString()}
            />
            <StatCard
              icon={<Clock className={`w-3.5 h-3.5 ${WARNING_STATUS.color}`} />}
              label="Last 24h"
              value={stats.accesses_last_24h.toString()}
            />
            <StatCard
              icon={<Shield className={`w-3.5 h-3.5 ${SUCCESS_STATUS.color}`} />}
              label="Last 7 Days"
              value={stats.accesses_last_7d.toString()}
            />
          </div>

          {/* Alerts */}
          {!hasActivity && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm ${WARNING_STATUS.bgColor} border ${WARNING_STATUS.borderColor} ${WARNING_STATUS.color}`}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              No recorded usage. This credential may be unused.
            </div>
          )}
          {unusedDays !== null && unusedDays > 30 && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm ${WARNING_STATUS.bgColor} border ${WARNING_STATUS.borderColor} ${WARNING_STATUS.color}`}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Last accessed {unusedDays} days ago. Consider reviewing if still needed.
            </div>
          )}

          {/* Timeline */}
          {stats.first_accessed_at && (
            <div className="text-sm text-muted-foreground/80 space-y-0.5">
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
            <div className="text-sm text-muted-foreground/80 py-3 text-center">
              No known dependents. Changes to this credential are low-risk.
            </div>
          ) : (
            <>
              <div className="text-sm text-muted-foreground/80 pb-1">
                Changing or deleting this credential will affect {dependents.length} persona{dependents.length !== 1 ? 's' : ''}:
              </div>
              {dependents.map((dep) => (
                <div
                  key={dep.persona_id}
                  className="flex items-center justify-between px-3 py-2 bg-secondary/20 border border-primary/10 rounded-xl"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                    <span className="text-sm text-foreground/80 truncate">{dep.persona_name}</span>
                    <span className={`text-sm px-1.5 py-0.5 rounded-lg border ${
                      dep.link_type === 'tool_connector'
                        ? `${INFO_STATUS.bgColor} ${INFO_STATUS.borderColor} ${INFO_STATUS.color}`
                        : `${AI_STATUS.bgColor} ${AI_STATUS.borderColor} ${AI_STATUS.color}`
                    }`}>
                      {dep.link_type === 'tool_connector' ? 'structural' : 'observed'}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground/80 shrink-0">
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
        <AuditLogTable auditLog={auditLog} />
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-secondary/20 border border-primary/10 rounded-xl">
      {icon}
      <div>
        <div className="text-xs font-semibold text-foreground/90 tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground/80">{label}</div>
      </div>
    </div>
  );
}

const AUDIT_FILTERS = ['all', 'decrypt', 'create', 'update', 'delete', 'healthcheck'] as const;
const AUDIT_PAGE_SIZE = 20;

function AuditLogTable({ auditLog }: { auditLog: CredentialAuditEntry[] }) {
  const [auditFilter, setAuditFilter] = useState('all');
  const [auditPage, setAuditPage] = useState(0);

  const filtered = useMemo(() => {
    if (auditFilter === 'all') return auditLog;
    return auditLog.filter((e) => e.operation === auditFilter);
  }, [auditLog, auditFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / AUDIT_PAGE_SIZE));
  const pageEntries = filtered.slice(auditPage * AUDIT_PAGE_SIZE, (auditPage + 1) * AUDIT_PAGE_SIZE);

  // Reset page when filter changes
  const handleFilterChange = (f: string) => {
    setAuditFilter(f);
    setAuditPage(0);
  };

  if (auditLog.length === 0) {
    return (
      <div className="text-sm text-muted-foreground/80 py-3 text-center" data-testid="audit-log-empty">
        No audit entries yet. Operations will be logged as they occur.
      </div>
    );
  }

  return (
    <div data-testid="audit-log-tab" className="space-y-2">
      {/* Filter */}
      <div className="flex items-center gap-1">
        {AUDIT_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => handleFilterChange(f)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              auditFilter === f
                ? 'bg-primary/15 text-foreground/90 border border-primary/20'
                : 'text-muted-foreground/60 hover:text-muted-foreground/80 hover:bg-secondary/30'
            }`}
          >
            {f === 'all' ? 'All' : (OP_LABELS[f]?.label ?? f)}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground/50">{filtered.length} entries</span>
      </div>

      {/* Table */}
      <div className="border border-primary/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-primary/10 bg-secondary/10">
              <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">Operation</th>
              <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">Detail</th>
              <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">Time</th>
            </tr>
          </thead>
          <tbody>
            {pageEntries.map((entry) => {
              const op = OP_LABELS[entry.operation] ?? { label: entry.operation, color: 'text-muted-foreground', dot: 'bg-muted-foreground' };
              return (
                <tr key={entry.id} className="border-b border-primary/5 last:border-b-0 hover:bg-secondary/10" data-testid={`audit-entry-${entry.id}`}>
                  <td className="px-3 py-1.5">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${op.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${op.dot}`} />
                      {op.label}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-foreground/80 truncate max-w-[300px]">
                    {entry.persona_name ? `by ${entry.persona_name}` : entry.detail ?? ''}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground/60 tabular-nums text-right whitespace-nowrap">
                    {formatRelativeTime(entry.created_at, '')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setAuditPage((p) => Math.max(0, p - 1))}
            disabled={auditPage === 0}
            className="p-1 rounded hover:bg-secondary/30 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground/70" />
          </button>
          <span className="text-xs text-muted-foreground/60 tabular-nums">
            Page {auditPage + 1}/{totalPages}
          </span>
          <button
            onClick={() => setAuditPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={auditPage >= totalPages - 1}
            className="p-1 rounded hover:bg-secondary/30 disabled:opacity-30 transition-colors"
          >
            <ChevronRightIcon className="w-3.5 h-3.5 text-muted-foreground/70" />
          </button>
        </div>
      )}
    </div>
  );
}
