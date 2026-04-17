import { AlertTriangle, Eye, Users } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { OP_LABELS } from './AuditLogTable';
import { STATUS_COLORS } from '@/lib/utils/designTokens';
import type { TimelineEntry } from './auditAnomalies';

const WARNING_STATUS = STATUS_COLORS.warning!;
const ERROR_STATUS = STATUS_COLORS.error!;

interface AuditTimelineEntriesProps {
  entries: TimelineEntry[];
}

export function AuditTimelineEntries({ entries }: AuditTimelineEntriesProps) {
  return (
    <div className="relative pl-4">
      {/* Vertical line */}
      <div className="absolute left-[7px] top-1 bottom-1 w-px bg-primary/10" />

      {entries.map((entry) => {
        const op = OP_LABELS[entry.operation] ?? {
          label: entry.operation,
          color: 'text-foreground',
          dot: 'bg-muted-foreground',
        };
        const hasAnomaly = entry.anomalies.length > 0;

        return (
          <div
            key={entry.id}
            className={`relative flex items-start gap-3 py-1.5 group ${
              hasAnomaly ? 'bg-amber-500/5 -mx-2 px-2 rounded-card border border-amber-500/10' : ''
            }`}
          >
            {/* Dot */}
            <div className={`relative z-10 mt-1.5 w-2 h-2 rounded-full shrink-0 ring-2 ring-background ${op.dot}`} />

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-medium ${op.color}`}>{op.label}</span>
                {entry.persona_name && (
                  <span className="text-xs text-foreground">by {entry.persona_name}</span>
                )}
                {entry.detail && !entry.persona_name && (
                  <span className="text-xs text-foreground truncate max-w-[200px]">{entry.detail}</span>
                )}
                <span className="text-xs text-foreground tabular-nums ml-auto shrink-0">
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
                          ? `${ERROR_STATUS.bg} ${ERROR_STATUS.border} ${ERROR_STATUS.text}`
                          : `${WARNING_STATUS.bg} ${WARNING_STATUS.border} ${WARNING_STATUS.text}`
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
                <div className="text-xs text-foreground truncate">{entry.detail}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
