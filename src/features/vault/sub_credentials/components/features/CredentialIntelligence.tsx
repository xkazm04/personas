import { useEffect, useState } from 'react';
import { Activity, Users, Clock, Shield, AlertTriangle, Link2 } from 'lucide-react';
import { silentCatch } from '@/lib/silentCatch';
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

/** Page-sized audit fetch — AuditLogTable client-pages 20 of this. */
const AUDIT_FETCH_LIMIT = 50;

const GHOST_BAR_WIDTHS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-1/3'];

function DependentsGhost() {
  return (
    <div aria-hidden="true" className="space-y-1.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-3 py-2 bg-secondary/20 border border-primary/10 rounded-modal animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-primary/[0.06] shrink-0" />
          <span className={`h-3.5 rounded bg-primary/[0.06] ${GHOST_BAR_WIDTHS[i % GHOST_BAR_WIDTHS.length]}`} />
        </div>
      ))}
    </div>
  );
}

export function CredentialIntelligence({ credentialId }: CredentialIntelligenceProps) {
  const { t, tx } = useTranslation();
  const it = t.vault.intelligence_tab;
  const [tab, setTab] = useState<IntelTab>('overview');
  const [stats, setStats] = useState<CredentialUsageStats | null>(null);
  const [dependents, setDependents] = useState<CredentialDependent[]>([]);
  const [auditLog, setAuditLog] = useState<CredentialAuditEntry[]>([]);
  const [dependentsLoading, setDependentsLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setDependents([]);
    setAuditLog([]);

    getCredentialUsageStats(credentialId)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(silentCatch('CredentialIntelligence:loadStats'));

    return () => { cancelled = true; };
  }, [credentialId]);

  useEffect(() => {
    if (tab !== 'dependents') return;
    let cancelled = false;
    setDependentsLoading(true);
    getCredentialDependents(credentialId)
      .then((d) => {
        if (!cancelled) setDependents(d);
      })
      .catch(silentCatch('CredentialIntelligence:loadDependents'))
      .finally(() => {
        if (!cancelled) setDependentsLoading(false);
      });
    return () => { cancelled = true; };
  }, [tab, credentialId]);

  useEffect(() => {
    if (tab !== 'audit') return;
    let cancelled = false;
    setAuditLoading(true);
    getCredentialAuditLog(credentialId, AUDIT_FETCH_LIMIT)
      .then((a) => {
        if (!cancelled) setAuditLog(a);
      })
      .catch(silentCatch('CredentialIntelligence:loadAudit'))
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });
    return () => { cancelled = true; };
  }, [tab, credentialId]);

  const hasActivity = stats && stats.totalAccesses > 0;
  const unusedDays = stats?.lastAccessedAt
    ? Math.floor((Date.now() - new Date(stats.lastAccessedAt).getTime()) / 86400000)
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

      {/* Overview tab — stat frames paint immediately; values fill when ready. */}
      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 3xl:grid-cols-6 4xl:grid-cols-8 gap-2">
            <StatCard
              icon={<Activity className={`w-3.5 h-3.5 ${INFO_STATUS.text}`} />}
              label={it.total_accesses}
              value={stats ? stats.totalAccesses.toString() : '—'}
            />
            <StatCard
              icon={<Users className={`w-3.5 h-3.5 ${AI_STATUS.text}`} />}
              label={it.distinct_personas}
              value={stats ? stats.distinctPersonas.toString() : '—'}
            />
            <StatCard
              icon={<Clock className={`w-3.5 h-3.5 ${WARNING_STATUS.text}`} />}
              label={it.last_24h}
              value={stats ? stats.accessesLast24h.toString() : '—'}
            />
            <StatCard
              icon={<Shield className={`w-3.5 h-3.5 ${SUCCESS_STATUS.text}`} />}
              label={it.last_7d}
              value={stats ? stats.accessesLast7d.toString() : '—'}
            />
          </div>

          {stats && !hasActivity && (
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

          {stats?.firstAccessedAt && (
            <div className="typo-body text-foreground space-y-0.5">
              <div>{tx(it.first_accessed, { timestamp: formatTimestamp(stats.firstAccessedAt, 'Never') })}</div>
              <div>{tx(it.last_accessed, { timestamp: formatTimestamp(stats.lastAccessedAt, 'Never') })}</div>
            </div>
          )}
        </div>
      )}

      {/* Dependents tab */}
      {tab === 'dependents' && (
        <div className="space-y-1.5">
          {dependentsLoading && dependents.length === 0 ? (
            <DependentsGhost />
          ) : dependents.length === 0 ? (
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
        <AuditLogTable auditLog={auditLog} isLoading={auditLoading} />
      )}
    </div>
  );
}
