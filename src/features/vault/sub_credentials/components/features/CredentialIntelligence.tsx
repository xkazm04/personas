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
import { useTranslation } from '@/i18n/useTranslation';

const INFO_STATUS = STATUS_COLORS.info!;
const AI_STATUS = STATUS_COLORS.ai!;
const SUCCESS_STATUS = STATUS_COLORS.success!;
const WARNING_STATUS = STATUS_COLORS.warning!;

interface CredentialIntelligenceProps {
  credentialId: string;
}

type IntelTab = 'overview' | 'dependents' | 'audit';

export function CredentialIntelligence({ credentialId }: CredentialIntelligenceProps) {
  const { t, tx } = useTranslation();
  const it = t.vault.intelligence_tab;
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
      <div className="flex items-center justify-center py-8 text-foreground">
        <LoadingSpinner size="lg" label={it.loading} />
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
        {(['overview', 'dependents', 'audit'] as IntelTab[]).map((tabId) => (
          <Button
            key={tabId}
            variant="ghost"
            size="sm"
            onClick={() => setTab(tabId)}
            className={tab === tabId
              ? `${AI_STATUS.bg} ${AI_STATUS.text} border ${AI_STATUS.border}`
              : 'text-foreground hover:text-foreground/95 hover:bg-secondary/40'
            }
          >
            {tabId === 'overview' && it.tab_overview}
            {tabId === 'dependents' && tx(it.tab_dependents, { count: dependents.length })}
            {tabId === 'audit' && tx(it.tab_audit_log, { count: auditLog.length })}
          </Button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && stats && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 3xl:grid-cols-6 4xl:grid-cols-8 gap-2">
            <StatCard
              icon={<Activity className={`w-3.5 h-3.5 ${INFO_STATUS.text}`} />}
              label={it.total_accesses}
              value={stats.total_accesses.toString()}
            />
            <StatCard
              icon={<Users className={`w-3.5 h-3.5 ${AI_STATUS.text}`} />}
              label={it.distinct_personas}
              value={stats.distinct_personas.toString()}
            />
            <StatCard
              icon={<Clock className={`w-3.5 h-3.5 ${WARNING_STATUS.text}`} />}
              label={it.last_24h}
              value={stats.accesses_last_24h.toString()}
            />
            <StatCard
              icon={<Shield className={`w-3.5 h-3.5 ${SUCCESS_STATUS.text}`} />}
              label={it.last_7d}
              value={stats.accesses_last_7d.toString()}
            />
          </div>

          {!hasActivity && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-modal typo-body ${WARNING_STATUS.bg} border ${WARNING_STATUS.border} ${WARNING_STATUS.text}`}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {it.no_usage}
            </div>
          )}
          {unusedDays !== null && unusedDays > 30 && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-modal typo-body ${WARNING_STATUS.bg} border ${WARNING_STATUS.border} ${WARNING_STATUS.text}`}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {tx(it.last_accessed_days, { days: unusedDays })}
            </div>
          )}

          {stats.first_accessed_at && (
            <div className="typo-body text-foreground space-y-0.5">
              <div>{tx(it.first_accessed, { timestamp: formatTimestamp(stats.first_accessed_at, 'Never') })}</div>
              <div>{tx(it.last_accessed, { timestamp: formatTimestamp(stats.last_accessed_at, 'Never') })}</div>
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
              heading={it.no_dependents}
              description={it.no_dependents_hint}
              className="py-6"
            />
          ) : (
            <>
              <div className="typo-body text-foreground pb-1">
                {tx(dependents.length === 1 ? it.dependents_warning_one : it.dependents_warning_other, { count: dependents.length })}
              </div>
              {dependents.map((dep) => (
                <div
                  key={dep.persona_id}
                  className="flex items-center justify-between px-3 py-2 bg-secondary/20 border border-primary/10 rounded-modal"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                    <span className="typo-body text-foreground truncate">{dep.persona_name}</span>
                    <span className={`typo-body px-1.5 py-0.5 rounded-card border ${
                      dep.link_type === 'tool_connector'
                        ? `${INFO_STATUS.bg} ${INFO_STATUS.border} ${INFO_STATUS.text}`
                        : `${AI_STATUS.bg} ${AI_STATUS.border} ${AI_STATUS.text}`
                    }`}>
                      {dep.link_type === 'tool_connector' ? it.link_structural : it.link_observed}
                    </span>
                  </div>
                  <div className="typo-body text-foreground shrink-0">
                    {dep.via_connector && <span>{tx(it.via_connector, { connector: dep.via_connector })}</span>}
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
