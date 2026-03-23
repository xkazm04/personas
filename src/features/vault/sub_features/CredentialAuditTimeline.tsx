import { useEffect, useState, useMemo } from 'react';
import { Shield, AlertTriangle, Clock, Eye, Users, Activity, ScrollText } from 'lucide-react';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { formatRelativeTime } from '@/lib/utils/formatters';
import {
  getCredentialAuditLog,
  getCredentialUsageStats,
} from '@/api/vault/credentials';
import type { CredentialAuditEntry } from '@/lib/bindings/CredentialAuditEntry';
import type { CredentialUsageStats } from '@/lib/bindings/CredentialUsageStats';
import { OP_LABELS } from './AuditLogTable';
import { STATUS_COLORS } from '@/lib/utils/designTokens';

const WARNING_STATUS = STATUS_COLORS.warning!;
const ERROR_STATUS = STATUS_COLORS.error!;
const SUCCESS_STATUS = STATUS_COLORS.success!;

interface CredentialAuditTimelineProps {
  credentialId: string;
}

type AnomalyType = 'burst' | 'off_hours' | 'new_persona' | 'rapid_decrypt';

interface AnomalyFlag {
  type: AnomalyType;
  label: string;
}

interface TimelineEntry extends CredentialAuditEntry {
  anomalies: AnomalyFlag[];
}

function detectAnomalies(entries: CredentialAuditEntry[]): TimelineEntry[] {
  if (entries.length === 0) return [];

  // Track known personas (those seen in the first 80% of history)
  const historyEnd = Math.floor(entries.length * 0.8);
  const historicPersonas = new Set<string>();
  for (let i = historyEnd; i < entries.length; i++) {
    const e = entries[i];
    if (e && e.persona_id) historicPersonas.add(e.persona_id);
  }

  return entries.map((entry, idx) => {
    const anomalies: AnomalyFlag[] = [];
    const entryTime = new Date(entry.created_at);
    const hour = entryTime.getUTCHours();

    // Off-hours access (midnight-5am UTC)
    if (hour >= 0 && hour < 5) {
      anomalies.push({ type: 'off_hours', label: 'Off-hours access' });
    }

    // New persona (not seen in historical entries)
    if (
      entry.persona_id &&
      historicPersonas.size > 0 &&
      !historicPersonas.has(entry.persona_id) &&
      idx < historyEnd
    ) {
      anomalies.push({ type: 'new_persona', label: 'First access by this persona' });
    }

    // Burst detection: 5+ accesses in a 60-second window
    if (idx < entries.length - 1) {
      let windowCount = 1;
      for (let j = idx + 1; j < entries.length; j++) {
        const diff = entryTime.getTime() - new Date(entries[j]!.created_at).getTime();
        if (diff <= 60_000) windowCount++;
        else break;
      }
      if (windowCount >= 5) {
        anomalies.push({ type: 'burst', label: `${windowCount} accesses in <1 min` });
      }
    }

    // Rapid decrypt: decrypt operations within 5s of each other from different callers
    if (entry.operation === 'decrypt' && idx < entries.length - 1) {
      const next = entries[idx + 1]!;
      if (next.operation === 'decrypt') {
        const gap = entryTime.getTime() - new Date(next.created_at).getTime();
        if (gap < 5000 && gap >= 0 && entry.detail !== next.detail) {
          anomalies.push({ type: 'rapid_decrypt', label: 'Rapid decrypt from different source' });
        }
      }
    }

    return { ...entry, anomalies };
  });
}

export function CredentialAuditTimeline({ credentialId }: CredentialAuditTimelineProps) {
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
      .catch((err) => console.error('Failed to load audit timeline:', err))
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [credentialId]);

  const timeline = useMemo(() => detectAnomalies(entries), [entries]);
  const anomalyCount = useMemo(() => timeline.filter((e) => e.anomalies.length > 0).length, [timeline]);

  const displayed = showAll ? timeline : timeline.slice(0, 30);

  if (loading) return null;

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
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-lg border ${WARNING_STATUS.bgColor} ${WARNING_STATUS.borderColor} ${WARNING_STATUS.color}`}>
            <AlertTriangle className="w-3 h-3" />
            {anomalyCount} anomal{anomalyCount === 1 ? 'y' : 'ies'}
          </span>
        ) : entries.length > 0 ? (
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-lg border ${SUCCESS_STATUS.bgColor} ${SUCCESS_STATUS.borderColor} ${SUCCESS_STATUS.color}`}>
            <Shield className="w-3 h-3" />
            No anomalies
          </span>
        ) : null}
      </div>

      {/* Timeline */}
      {entries.length === 0 ? (
        <EmptyIllustration
          icon={ScrollText}
          heading="No audit entries yet"
          description="Access events will appear here."
          className="py-6"
        />
      ) : (
        <div className="relative pl-4">
          {/* Vertical line */}
          <div className="absolute left-[7px] top-1 bottom-1 w-px bg-primary/10" />

          {displayed.map((entry) => {
            const op = OP_LABELS[entry.operation] ?? {
              label: entry.operation,
              color: 'text-muted-foreground',
              dot: 'bg-muted-foreground',
            };
            const hasAnomaly = entry.anomalies.length > 0;

            return (
              <div
                key={entry.id}
                className={`relative flex items-start gap-3 py-1.5 group ${
                  hasAnomaly ? 'bg-amber-500/5 -mx-2 px-2 rounded-lg border border-amber-500/10' : ''
                }`}
              >
                {/* Dot */}
                <div className={`relative z-10 mt-1.5 w-2 h-2 rounded-full shrink-0 ring-2 ring-background ${op.dot}`} />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-medium ${op.color}`}>{op.label}</span>
                    {entry.persona_name && (
                      <span className="text-xs text-foreground/70">by {entry.persona_name}</span>
                    )}
                    {entry.detail && !entry.persona_name && (
                      <span className="text-xs text-foreground/60 truncate max-w-[200px]">{entry.detail}</span>
                    )}
                    <span className="text-xs text-muted-foreground/60 tabular-nums ml-auto shrink-0">
                      {formatRelativeTime(entry.created_at, '')}
                    </span>
                  </div>
                  {/* Anomaly flags */}
                  {hasAnomaly && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {entry.anomalies.map((a, i) => (
                        <span
                          key={i}
                          className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                            a.type === 'burst' || a.type === 'rapid_decrypt'
                              ? `${ERROR_STATUS.bgColor} ${ERROR_STATUS.borderColor} ${ERROR_STATUS.color}`
                              : `${WARNING_STATUS.bgColor} ${WARNING_STATUS.borderColor} ${WARNING_STATUS.color}`
                          }`}
                        >
                          {a.type === 'off_hours' && <Eye className="w-2.5 h-2.5" />}
                          {a.type === 'new_persona' && <Users className="w-2.5 h-2.5" />}
                          {(a.type === 'burst' || a.type === 'rapid_decrypt') && <AlertTriangle className="w-2.5 h-2.5" />}
                          {a.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Detail line for persona entries */}
                  {entry.detail && entry.persona_name && (
                    <div className="text-xs text-muted-foreground/50 truncate">{entry.detail}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Show more */}
      {!showAll && timeline.length > 30 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full text-center text-xs text-muted-foreground/70 hover:text-foreground/80 py-1.5 rounded-lg hover:bg-secondary/20 transition-colors"
        >
          Show all {timeline.length} entries
        </button>
      )}
    </div>
  );
}
