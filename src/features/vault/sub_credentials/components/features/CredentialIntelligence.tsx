import { useEffect, useState } from 'react';
import { Activity, Users, Clock, Shield, AlertTriangle, Link2 } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { createLogger } from '@/lib/log';

const logger = createLogger('credential-intelligence');
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { formatTimestamp } from '@/lib/utils/formatters';
import {
  getCredentialAuditLog,
  getCredentialUsageStats,
  getCredentialDependents,
} from '@/api/vault/credentials';
import type { CredentialAuditEntry } from '@/lib/bindings/CredentialAuditEntry';
import type { CredentialUsageStats } from '@/lib/bindings/CredentialUsageStats';
import type { CredentialDependent } from '@/lib/bindings/CredentialDependent';
import { Button } from '@/features/shared/components/buttons';
import { STATUS_COLORS } from '@/lib/utils/designTokens';
import { StatCard } from './IntelligenceStatCard';
import { AuditLogTable } from './AuditLogTable';

const INFO_STATUS = STATUS_COLORS.info!;
const AI_STATUS = STATUS_COLORS.ai!;
const SUCCESS_STATUS = STATUS_COLORS.success!;
const WARNING_STATUS = STATUS_COLORS.warning!;

interface CredentialIntelligenceProps {
  credentialId: string;
}

type IntelTab = 'overview' | 'dependents' | 'audit';

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
      .catch((err) => { logger.error('Failed to load credential intelligence', { error: String(err) }); })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [credentialId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/60">
        <LoadingSpinner size="lg" label="Loading intelligence data" />
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
          <Button
            key={t}
            variant="ghost"
            size="sm"
            onClick={() => setTab(t)}
            className={tab === t
              ? `${AI_STATUS.bg} ${AI_STATUS.text} border ${AI_STATUS.border}`
              : 'text-muted-foreground/80 hover:text-foreground/95 hover:bg-secondary/40'
            }
          >
            {t === 'overview' && 'Overview'}
            {t === 'dependents' && `Dependents (${dependents.length})`}
            {t === 'audit' && `Audit Log (${auditLog.length})`}
          </Button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && stats && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 3xl:grid-cols-6 4xl:grid-cols-8 gap-2">
            <StatCard
              icon={<Activity className={`w-3.5 h-3.5 ${INFO_STATUS.text}`} />}
              label="Total Accesses"
              value={stats.total_accesses.toString()}
            />
            <StatCard
              icon={<Users className={`w-3.5 h-3.5 ${AI_STATUS.text}`} />}
              label="Distinct Personas"
              value={stats.distinct_personas.toString()}
            />
            <StatCard
              icon={<Clock className={`w-3.5 h-3.5 ${WARNING_STATUS.text}`} />}
              label="Last 24h"
              value={stats.accesses_last_24h.toString()}
            />
            <StatCard
              icon={<Shield className={`w-3.5 h-3.5 ${SUCCESS_STATUS.text}`} />}
              label="Last 7 Days"
              value={stats.accesses_last_7d.toString()}
            />
          </div>

          {!hasActivity && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm ${WARNING_STATUS.bg} border ${WARNING_STATUS.border} ${WARNING_STATUS.text}`}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              No recorded usage. This credential may be unused.
            </div>
          )}
          {unusedDays !== null && unusedDays > 30 && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm ${WARNING_STATUS.bg} border ${WARNING_STATUS.border} ${WARNING_STATUS.text}`}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Last accessed {unusedDays} days ago. Consider reviewing if still needed.
            </div>
          )}

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
            <EmptyIllustration
              icon={Link2}
              heading="No known dependents"
              description="Changes to this credential are low-risk."
              className="py-6"
            />
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
                        ? `${INFO_STATUS.bg} ${INFO_STATUS.border} ${INFO_STATUS.text}`
                        : `${AI_STATUS.bg} ${AI_STATUS.border} ${AI_STATUS.text}`
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
