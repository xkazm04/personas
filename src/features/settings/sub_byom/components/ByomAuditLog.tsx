import { memo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ProviderAuditEntry } from '@/api/system/byom';
import { ENGINE_LABELS } from '../libs/byomHelpers';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { useTranslation } from '@/i18n/useTranslation';

const ROW_HEIGHT = 44;
const VIRTUALIZE_THRESHOLD = 25;
const SCROLL_HEIGHT_PX = 480;

const STATUS_CLASSES: Record<string, string> = {
  completed: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
};
const STATUS_DEFAULT = 'bg-secondary/50 text-foreground';

const GRID_COLS = 'minmax(0,2.2fr) minmax(0,2fr) minmax(0,2.2fr) minmax(0,1.4fr) minmax(0,1.1fr) minmax(0,1.1fr)';

function statusClass(status: string): string {
  return STATUS_CLASSES[status] ?? STATUS_DEFAULT;
}

function formatCost(value: number | null): string {
  return value != null ? `$${value.toFixed(4)}` : '-';
}

function formatDuration(ms: number | null): string {
  return ms != null ? `${Math.round(ms / 1000)}s` : '-';
}

interface AuditRowProps {
  entry: ProviderAuditEntry;
  failoverLabel: string;
  style?: React.CSSProperties;
}

const AuditRow = memo(function AuditRow({ entry, failoverLabel, style }: AuditRowProps) {
  return (
    <div
      role="row"
      className="grid items-center border-b border-primary/5 hover:bg-secondary/20"
      style={{ ...style, gridTemplateColumns: GRID_COLS }}
    >
      <div role="cell" className="p-2.5 min-w-0 flex items-center gap-1.5">
        <span className="text-foreground truncate">
          {ENGINE_LABELS[entry.engine_kind] || entry.engine_kind}
        </span>
        {entry.was_failover && (
          <span className="typo-caption shrink-0 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">
            {failoverLabel}
          </span>
        )}
      </div>
      <div role="cell" className="p-2.5 text-foreground truncate">{entry.model_used || '-'}</div>
      <div role="cell" className="p-2.5 text-foreground truncate">{entry.persona_name}</div>
      <div role="cell" className="p-2.5 min-w-0">
        <span className={`typo-caption px-1.5 py-0.5 rounded-full ${statusClass(entry.status)}`}>
          {entry.status}
        </span>
      </div>
      <div role="cell" className="p-2.5 text-right text-foreground">{formatCost(entry.cost_usd)}</div>
      <div role="cell" className="p-2.5 text-right text-foreground">{formatDuration(entry.duration_ms)}</div>
    </div>
  );
});

interface ByomAuditLogProps {
  auditLog: ProviderAuditEntry[];
}

export function ByomAuditLog({ auditLog }: ByomAuditLogProps) {
  const { t } = useTranslation();
  const s = t.settings.byom;
  const failoverLabel = s.failover;

  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = auditLog.length > VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: auditLog.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    enabled: shouldVirtualize,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div className="space-y-4">
      <div className="rounded-modal border border-primary/10 bg-card-bg p-4 space-y-3">
        <SectionHeading title={s.audit_title} />
        <p className="typo-body text-foreground">
          {s.audit_hint}
        </p>

        {auditLog.length === 0 ? (
          <p className="typo-body text-foreground text-center py-6">
            {s.audit_empty}
          </p>
        ) : (
          <div
            role="table"
            className="border border-primary/10 rounded-card overflow-hidden typo-body"
          >
            <div
              role="row"
              className="grid border-b border-primary/10 bg-secondary/30"
              style={{ gridTemplateColumns: GRID_COLS }}
            >
              <div role="columnheader" className="text-left p-2.5 text-foreground font-medium">{s.audit_provider}</div>
              <div role="columnheader" className="text-left p-2.5 text-foreground font-medium">{s.audit_model}</div>
              <div role="columnheader" className="text-left p-2.5 text-foreground font-medium">{s.audit_persona}</div>
              <div role="columnheader" className="text-left p-2.5 text-foreground font-medium">{s.audit_status}</div>
              <div role="columnheader" className="text-right p-2.5 text-foreground font-medium">{s.audit_cost}</div>
              <div role="columnheader" className="text-right p-2.5 text-foreground font-medium">{s.audit_time}</div>
            </div>
            <div
              ref={scrollRef}
              role="rowgroup"
              className="overflow-y-auto"
              style={shouldVirtualize ? { maxHeight: `${SCROLL_HEIGHT_PX}px` } : undefined}
            >
              {shouldVirtualize ? (
                <div style={{ height: `${totalSize}px`, position: 'relative' }}>
                  {virtualItems.map((virtualRow) => {
                    const entry = auditLog[virtualRow.index]!;
                    return (
                      <AuditRow
                        key={entry.id}
                        entry={entry}
                        failoverLabel={failoverLabel}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      />
                    );
                  })}
                </div>
              ) : (
                auditLog.map((entry) => (
                  <AuditRow
                    key={entry.id}
                    entry={entry}
                    failoverLabel={failoverLabel}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
