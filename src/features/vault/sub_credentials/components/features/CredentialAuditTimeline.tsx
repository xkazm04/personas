import { useEffect, useState, useMemo } from 'react';
import { Shield, AlertTriangle, Clock, Users, Activity, ScrollText } from 'lucide-react';
import { createLogger } from '@/lib/log';

const logger = createLogger('credential-audit-timeline');
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import {
  getCredentialAuditLog,
  getCredentialUsageStats,
} from '@/api/vault/credentials';
import type { CredentialAuditEntry } from '@/lib/bindings/CredentialAuditEntry';
import type { CredentialUsageStats } from '@/lib/bindings/CredentialUsageStats';
import { STATUS_COLORS } from '@/lib/utils/designTokens';
import { detectAnomalies } from './auditAnomalies';
import { AuditTimelineEntries } from './AuditTimelineEntries';
import { useTranslation } from '@/i18n/useTranslation';

const WARNING_STATUS = STATUS_COLORS.warning!;
const SUCCESS_STATUS = STATUS_COLORS.success!;

interface CredentialAuditTimelineProps {
  credentialId: string;
}

export function CredentialAuditTimeline({ credentialId }: CredentialAuditTimelineProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<CredentialAuditEntry[]>([]);
  const [stats, setStats] = useState<CredentialUsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      getCredentialAuditLog(credentialId, 500),
      getCredentialUsageStats(credentialId),
    ])
      .then(([log, s]) => {
        if (cancelled) return;
        setEntries(log);
        setStats(s);
      })
      .catch((err) => logger.error('Failed to load audit timeline', { error: String(err) }))
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [credentialId]);

  const timeline = useMemo(() => detectAnomalies(entries), [entries]);
  const anomalyCount = useMemo(() => timeline.filter((e) => e.anomalies.length > 0).length, [timeline]);

  const displayed = showAll ? timeline : timeline.slice(0, 30);

  if (loading) return (
    <div className="flex items-center justify-center py-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground/60">
        <div className="w-3.5 h-3.5 border-2 border-muted-foreground/30 border-t-muted-foreground/70 rounded-full animate-spin" />
        Loading audit timeline...
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {stats && (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/80">
              <Activity className="w-3 h-3" />
              {stats.total_accesses} total
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/80">
              <Users className="w-3 h-3" />
              {stats.distinct_personas} persona{stats.distinct_personas !== 1 ? 's' : ''}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/80">
              <Clock className="w-3 h-3" />
              {stats.accesses_last_24h} in 24h
            </span>
          </>
        )}
        {anomalyCount > 0 ? (
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-card border ${WARNING_STATUS.bg} ${WARNING_STATUS.border} ${WARNING_STATUS.text}`}>
            <AlertTriangle className="w-3 h-3" />
            {anomalyCount} anomal{anomalyCount === 1 ? 'y' : 'ies'}
          </span>
        ) : entries.length > 0 ? (
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-card border ${SUCCESS_STATUS.bg} ${SUCCESS_STATUS.border} ${SUCCESS_STATUS.text}`}>
            <Shield className="w-3 h-3" />
            No anomalies
          </span>
        ) : null}
      </div>

      {/* Timeline */}
      {entries.length === 0 ? (
        <EmptyIllustration
          icon={ScrollText}
          heading={t.vault.audit_log.empty}
          description={t.vault.audit_log.access_events_hint}
          className="py-6"
        />
      ) : (
        <AuditTimelineEntries entries={displayed} />
      )}

      {/* Show more */}
      {!showAll && timeline.length > 30 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full text-center text-xs text-muted-foreground/70 hover:text-foreground/80 py-1.5 rounded-card hover:bg-secondary/20 transition-colors"
        >
          Show all {timeline.length} entries
        </button>
      )}
    </div>
  );
}
