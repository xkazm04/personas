// Prototype variant B — "Receipts"
//
// Strategy: each handled incident is a RECEIPT the system hands you — a
// bordered card with a success-green header strip ("resumed · 4m after
// raised"), the title as a heading, and a two-column key/value block
// underneath (source, agent, raised, resumed) where keys are small caps and
// values are body weight. The latency is a large green numeral on the right
// of the header strip — the receipt's "total". Trust reads from the
// completeness of each stub, not from a summary line.

import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AthenaComposedBadge } from '@/features/shared/components/feedback/AthenaComposedBadge';
import { severityBadgeClass, sourceTableIcon, sourceTableLabel } from '../../libs/incidentTaxonomy';
import { resumeLatencyLabel, type AutonomousLogProps } from './autonomousLogTypes';
import { AutonomousLogFrame } from './autonomousLogShared';

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col gap-0.5 min-w-0">
      {/* muted-ok: the key half of a key/value block */}
      <span className="typo-caption uppercase tracking-wider text-foreground/55">{k}</span>
      <span className="typo-body text-foreground truncate">{children}</span>
    </span>
  );
}

export function AutonomousLogReceipts(props: AutonomousLogProps) {
  const { t } = useTranslation();
  const l = t.overview.incidents.ledger;
  return (
    <AutonomousLogFrame
      {...props}
      rowHeight={96}
      rowsClassName="grid grid-cols-1 lg:grid-cols-2 gap-3 px-4 py-3"
      header={
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/10">
          <ShieldCheck className="h-4 w-4 text-status-success" aria-hidden="true" />
          <h3 className="typo-heading text-foreground">{t.overview.incidents.noc_handled_title}</h3>
          <AthenaComposedBadge variant="handled" label={t.overview.incidents.noc_handled_by} />
        </div>
      }
      renderRow={(inc) => {
        const SourceIcon = sourceTableIcon(inc.sourceTable);
        const latency = resumeLatencyLabel(inc);
        return (
          <button type="button" onClick={() => props.onOpenIncident(inc)}
            className="group flex w-full flex-col overflow-hidden rounded-card border border-primary/15 bg-secondary/20 text-left transition-colors hover:border-status-success/40 focus-ring">
            <span className="flex items-center justify-between gap-2 border-b border-status-success/20 bg-status-success/[0.07] px-3 py-1.5">
              <span className="inline-flex items-center gap-1.5 typo-caption font-medium text-status-success">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {t.overview.incidents.noc_handled_continued}
                {inc.continuedAt && <RelativeTime timestamp={inc.continuedAt} className="text-status-success" />}
              </span>
              {latency && <span className="typo-data tabular-nums text-status-success">{latency}</span>}
            </span>
            <span className="flex items-start justify-between gap-2 px-3 pt-2.5">
              <span className="typo-heading text-foreground">{inc.title}</span>
              <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-foreground/40 transition-colors group-hover:text-primary" aria-label={l.open_incident} />
            </span>
            <span className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 pb-3 pt-2">
              <KV k={t.overview.incidents.filter_severity_label}>
                <span className={`inline-flex w-fit rounded-card border px-1.5 py-px typo-caption font-medium ${severityBadgeClass(inc.severity)}`}>
                  {tokenLabel(t, 'severity', inc.severity)}
                </span>
              </KV>
              <KV k={t.overview.incidents.filter_source_label}>
                <span className="inline-flex items-center gap-1.5"><SourceIcon className="h-3.5 w-3.5 text-foreground/70" aria-hidden="true" />{sourceTableLabel(t, inc.sourceTable)}</span>
              </KV>
              <KV k={t.overview.incidents.filter_persona_label}>{inc.personaName ?? '—'}</KV>
              <KV k={l.col_raised}><RelativeTime timestamp={inc.createdAt} /></KV>
            </span>
          </button>
        );
      }}
    />
  );
}
